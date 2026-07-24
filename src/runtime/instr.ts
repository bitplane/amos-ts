import { AmosError, VF, VI, VS, int, num, str, varType } from '../interp/values'
import { varKey } from '../interp/prescan'
import type { Instr, Func } from '../interp/builtins'
import { parseAmosNumber } from '../interp/builtins'
import { parseAmosFile } from '../loader/amosfile'
import { parseIlbm } from '../loader/iff'
import { parsePacPic } from '../loader/pacpic'
import { DEFAULT_FLASH_SPEC, Runtime, SYS_MESSAGES, parseFlashSpec } from './runtime'
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
import { MF_BAR, MF_BOUGE, MF_FIXED, MF_OFF, MF_SEP, MF_TBOUGE, MF_TOTAL, bankToMenu, compileMenuObject, menuCalc, menuToBank } from './menu'
import { ENV_BELL, ENV_BOOM, ENV_SHOOT } from './music'
import { squash as squashBytes, unsquash as unsquashBytes } from './squash'
import { formLoad, formPlay, formSize } from './iffanim'
import { parsePpBank, writePpBank } from '../loader/powerpacker'

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

/** Screen Width/Height(n): explicit n must be open (CheckScreenNumber + AdrEc) */
function screenArg(rt: Runtime, a: import('../interp/values').Value[]): Screen {
  if (a.length > 0 && int(a[0]!) >= 0) {
    const s = rt.screens.get(int(a[0]!))
    if (!s) throw new AmosError(`screen not opened: ${int(a[0]!)}`)
    return s
  }
  return rt.screen
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

/**
 * Logbase/Phybase (FnLogBase +Lib.s:8852): bitplane addresses. The port's
 * screens are chunky, so these return stable fake addresses that resolve
 * nowhere — plane pokes are ignored (see NOTES).
 */
function planeBase(rt: Runtime, plane: number, phys: number): number {
  // Logbase(p)/Phybase(p): the address of bitplane p of the logical/physical
  // bitmap. Faithful Amiga layout — planes are `planeSize` apart (+W.s:1856),
  // and the region is backed by the screen's planar mirror (Runtime.resolveAddr).
  const s = rt.screen
  if (plane < 0 || plane >= s.depth) throw new AmosError('function call error')
  // single-buffered screens open with EcLogic == EcPhysic (+W.s:3001); only
  // Double Buffer splits the physical bitmap onto its own address
  const physical = phys !== 0 && s.doubleBuffered
  const base = rt.screenChipBase(s.index) + (physical ? Runtime.SCREEN_PHY_OFFSET : 0)
  return (base + plane * s.planeSize) >>> 0
}

/**
 * Set Rainbow's table build (TRSet +W.s:4020-4100): each channel is a
 * little state machine driven by "(interval,step,count)" groups — every
 * `interval` lines add `step` to the 4-bit component, `count` times, then
 * load the next group (wrapping at the end; count 0 repeats forever).
 * Numbers are AniLong's (+W.s:7088): optional '-', decimal or $hex.
 * Groups must be juxtaposed — a comma BETWEEN groups is a syntax error
 * (RainTok +W.s:4118); lowercase letters and spaces are skipped as noise
 * (AniChr +W.s:7070). An empty string freezes the channel at its seed.
 */
function buildRainbowTable(len: number, seed: number, rs: string, gs: string, bs: string): Uint16Array {
  const parse = (src: string): Array<[number, number, number]> => {
    // AniChr keeps chars 33..'Z' (plus '|' and ESC, which then fail the
    // structural checks); everything else is skipped
    const sig: string[] = []
    for (const ch of src) {
      const cc = ch.charCodeAt(0)
      if ((cc >= 33 && cc <= 90) || cc === 124 || cc === 27) sig.push(ch)
    }
    let p = 0
    const next = (): string => sig[p++] ?? ''
    const num = (): number => {
      let neg = false
      let ch = next()
      if (ch === '-') {
        neg = true
        ch = next()
      }
      let v = 0
      if (ch === '$') {
        let any = false
        for (;;) {
          const d = sig[p] ?? ''
          const dv = /[0-9]/.test(d) ? d.charCodeAt(0) - 48 : /[A-F]/.test(d) ? d.charCodeAt(0) - 55 : -1
          if (dv < 0) break
          v = v * 16 + dv
          p++
          any = true
        }
        if (!any) throw new Error('rainbow syntax')
      } else {
        if (!/[0-9]/.test(ch)) throw new Error('rainbow syntax')
        v = ch.charCodeAt(0) - 48
        for (;;) {
          const d = sig[p] ?? ''
          if (!/[0-9]/.test(d)) break
          v = v * 10 + (d.charCodeAt(0) - 48)
          p++
        }
      }
      return neg ? -v : v
    }
    const groups: Array<[number, number, number]> = []
    while (p < sig.length) {
      if (next() !== '(') throw new Error('rainbow syntax')
      const a = num()
      if (a <= 0) throw new Error('rainbow syntax') // ble RainTE
      if (next() !== ',') throw new Error('rainbow syntax')
      const b = num()
      if (next() !== ',') throw new Error('rainbow syntax')
      const c = num()
      if (c < 0) throw new Error('rainbow syntax') // blt RainTE
      if (next() !== ')') throw new Error('rainbow syntax')
      groups.push([a, b, c])
    }
    return groups
  }
  interface Chan {
    val: number
    plus: number
    cpt: number
    vit: number
    nb: number
    pos: number
    toks: Array<[number, number, number]>
  }
  const mkChan = (src: string, nib: number): Chan => ({
    val: nib & 15,
    plus: 0,
    cpt: 1,
    vit: 0,
    nb: 1,
    pos: 0,
    toks: parse(src),
  })
  // channel seeds: R = seed bits 8-11, G = 4-7, B = 0-3 (TRSet pushes B,G,R)
  const chans = [mkChan(rs, seed >> 8), mkChan(gs, seed >> 4), mkChan(bs, seed)]
  const step = (ch: Chan): void => {
    if (ch.cpt === 0) return // frozen channel
    if (--ch.cpt !== 0) return
    ch.cpt = ch.vit
    ch.val = (ch.val + ch.plus) & 15
    if (ch.nb === 0) return // count 0: repeat the group forever
    if (--ch.nb !== 0) return
    if (ch.toks.length === 0) {
      // empty string: the zeroed group — freeze from now on
      ch.cpt = 0
      ch.vit = 0
      ch.plus = 0
      return
    }
    if (ch.pos >= ch.toks.length) ch.pos = 0
    const [a, b, c] = ch.toks[ch.pos++]!
    ch.cpt = a
    ch.vit = a
    ch.plus = b
    ch.nb = c
  }
  const table = new Uint16Array(len)
  for (let i = 0; i < len; i++) {
    for (const ch of chans) step(ch)
    table[i] = (chans[0]!.val << 8) | (chans[1]!.val << 4) | chans[2]!.val
  }
  return table
}

/**
 * STOS-string scanner (StChr +W.s:7494): spaces skipped, lowercase
 * upper-cased; numbers are AniLong's (optional '-', decimal or $hex).
 */
function stosScan(src: string): { next: () => string; num: () => number; done: () => boolean } {
  const sig: string[] = []
  for (const ch of src) {
    if (ch === ' ') continue
    sig.push(ch >= 'a' && ch <= 'z' ? String.fromCharCode(ch.charCodeAt(0) - 32) : ch)
  }
  let p = 0
  const next = (): string => sig[p++] ?? ''
  const num = (): number => {
    let neg = false
    let ch = next()
    if (ch === '-') {
      neg = true
      ch = next()
    }
    let v = 0
    if (ch === '$') {
      let any = false
      for (;;) {
        const d = sig[p] ?? ''
        const dv = /[0-9]/.test(d) ? d.charCodeAt(0) - 48 : /[A-F]/.test(d) ? d.charCodeAt(0) - 55 : -1
        if (dv < 0) break
        v = v * 16 + dv
        p++
        any = true
      }
      if (!any) throw new AmosError('syntax error in animation string')
    } else {
      if (!/[0-9]/.test(ch)) throw new AmosError('syntax error in animation string')
      v = ch.charCodeAt(0) - 48
      while (/[0-9]/.test(sig[p] ?? '')) v = v * 10 + (sig[p++]!.charCodeAt(0) - 48)
    }
    return neg ? -v : v
  }
  return { next, num, done: () => p >= sig.length }
}

/** Anim string "(image,delay)...[L]" (AniStos +W.s:7490) */
function parseStosAnim(src: string): { pairs: Array<[number, number]>; loop: boolean } {
  const s = stosScan(src)
  const synt = (): never => {
    throw new AmosError('syntax error in animation string')
  }
  const pairs: Array<[number, number]> = []
  if (s.next() !== '(') synt()
  for (;;) {
    const img = s.num()
    if (s.next() !== ',') synt()
    const delay = s.num()
    if (delay < 0) synt()
    if (s.next() !== ')') synt()
    pairs.push([img, delay])
    const c = s.next()
    if (c === '') return { pairs, loop: false }
    if (c === 'L') return { pairs, loop: true }
    if (c !== '(') synt()
  }
}

/** Move string "[start](speed,step,count)...[L|E][pos]" (AnMve +W.s:7516) */
function parseStosMove(src: string): { start: number | null; groups: Array<[number, number, number]>; loop: boolean; endPos: number | null } {
  const s = stosScan(src)
  const synt = (): never => {
    throw new AmosError('syntax error in animation string')
  }
  let start: number | null = null
  let c = s.next()
  if (c !== '(') {
    if (c === '') synt()
    // a leading number is the starting coordinate
    let neg = false
    if (c === '-') {
      neg = true
      c = s.next()
    }
    if (!/[0-9$]/.test(c)) synt()
    let v = 0
    if (c === '$') v = s.num()
    else {
      v = c.charCodeAt(0) - 48
      for (;;) {
        const d = s.next()
        if (/[0-9]/.test(d)) v = v * 10 + (d.charCodeAt(0) - 48)
        else {
          c = d
          break
        }
      }
    }
    start = neg ? -v : v
    if (c !== '(') synt()
  }
  const groups: Array<[number, number, number]> = []
  for (;;) {
    const speed = s.num()
    if (speed <= 0) synt()
    if (s.next() !== ',') synt()
    const step = s.num()
    if (s.next() !== ',') synt()
    const count = s.num()
    if (count < 0) synt()
    if (s.next() !== ')') synt()
    groups.push([speed, step, count])
    const t = s.next()
    if (t === '(') continue
    if (t === '') return { start, groups, loop: false, endPos: null }
    let loop = false
    if (t === 'L') loop = true
    else if (t !== 'E') synt()
    const endPos = s.done() ? null : s.num()
    return { start, groups, loop, endPos }
  }
}

/** the ROM font list (Get Fonts / Font$) — the port carries Topaz only */
// the ROM faces plus the stock Workbench Fonts: drawer, so Set Font
// numbers that work on a real machine work here (rendering stays the
// single 8x8 face — see NOTES). examinedFonts() applies the Get Fonts
// variant's rom/disc mask.
const FONT_LIST = [
  { name: 'topaz.font', height: 8, type: 'Rom' },
  { name: 'topaz.font', height: 9, type: 'Rom' },
  ...[
    ['courier.font', [11, 13, 15, 18, 24]],
    ['diamond.font', [12, 20]],
    ['emerald.font', [17, 20]],
    ['garnet.font', [9, 16]],
    ['helvetica.font', [9, 11, 13, 15, 18, 24]],
    ['opal.font', [9, 12]],
    ['pearl.font', [8]],
    ['ruby.font', [8, 12, 15]],
    ['sapphire.font', [14, 19]],
    ['times.font', [11, 13, 15, 18, 24]],
  ].flatMap(([name, sizes]) => (sizes as number[]).map((height) => ({ name: name as string, height, type: 'Disc' }))),
]

/**
 * Sprite Base / Icon Base (Sb/AdBob +Lib.s:12792): index = |n| & $3FFF
 * with 0 erroring; a missing bank is "bank not reserved"; out of range
 * is error 74 "Icon not defined" for BOTH functions (AdBErr is shared —
 * a real 68k quirk). Positive n returns the image record's address in
 * the synthesized bank, negative n the mask pointer, which stays 0
 * (the 68k computes masks lazily).
 */
function objBase(rt: Runtime, kind: 'sprites' | 'icons', n: number): number {
  const idx = Math.abs(n) & 0x3fff
  if (idx === 0) throw new AmosError('Illegal function call', 23)
  const bank = kind === 'sprites' ? rt.spriteBank : rt.iconBank
  if (!bank) throw new AmosError('bank not reserved', 36)
  if (idx > bank.images.length) throw new AmosError('icon not defined')
  if (n < 0) return 0
  const img = rt.objectBankImage(kind)!
  const off = 2 + (idx - 1) * 8
  return (((img[off]! << 24) | (img[off + 1]! << 16) | (img[off + 2]! << 8) | img[off + 3]!) >>> 0) | 0
}

/** Frame Play/Skip core: resolve the buffer, walk, return the new address */
function framePlaySkip(rt: Runtime, ad: number, n: number, param: number | null, skip: boolean): number {
  if (n < 0 || n >= 32768) throw new AmosError('Illegal function call', 23)
  const base = ad > 0 && ad < 0x10000 ? rt.bankBase(ad) : ad
  const m = rt.bankOrAddr(ad)
  if (!m) throw new AmosError('bad IFF format')
  const end = formPlay(rt, m.data, m.off, n, param, skip)
  return base + (end - m.off)
}

/**
 * GetPut (+Lib.s:5382): record-1 must be under 65500, the channel must
 * be the random-access type ("file type mismatch"), and the offset is
 * (record-1) * record size. Callers apply their own EOF rule.
 */
function getPut(rt: Runtime, it: It): { c: NonNullable<ReturnType<Runtime['fileChans']['get']>>; off: number } {
  it.accept('#')
  const n = it.evalInt()
  it.expect(',')
  const rec = it.evalInt()
  if (rec - 1 < 0 || rec - 1 >= 65500) throw new AmosError('Illegal function call', 23)
  const c = rt.chan(n)
  if (c.mode !== 'random' || !c.fields) throw new AmosError('file type mismatch')
  return { c, off: (rec - 1) * c.recSize! }
}

/**
 * One Dir/Dev listing entry, exactly as FnFillNext returns it
 * (+Lib.s:5583): [marker][name] truncated then space-padded to the Set Dir
 * name width (FillFPoke +Lib.s:6328, FillF32 set), followed by an 8-char
 * field with the size left-aligned (LongToDec) — or spaces when the entry
 * is a directory ('*' marker) or its size is negative (devices).
 */
function fillEntry(rt: Runtime, marker: string, name: string, size: number | null): string {
  const nameField = (marker + name).slice(0, rt.dirWidth).padEnd(rt.dirWidth)
  const sizeField = marker !== '*' && size !== null && size >= 0 ? String(size).slice(0, 8).padEnd(8) : ' '.repeat(8)
  return nameField + sizeField
}

function devFirst(rt: Runtime, filter: string): string {
  const vfs = rt.vfs
  if (!vfs) return ''
  // the filter's first letter selects the class: D* = devices (volumes),
  // A* = assigns, anything else lists both (FillDev +Lib.s:6088-6101);
  // the whole filter then jokers against "NAME:" (FDev3)
  const first = filter.charAt(0).toUpperCase()
  const names = [
    ...(first === 'A' ? [] : vfs.volumeNames()),
    ...(first === 'D' ? [] : vfs.assignNames()),
  ].map((n) => `${n}:`)
  const rx = amigaPattern(filter === '' ? '*' : filter)
  const entries = names
    .filter((n) => rx.test(n))
    .map((n) => fillEntry(rt, ' ', n, null))
    .sort((a, b) => (fillSortKey(a) < fillSortKey(b) ? -1 : 1))
  rt.devIter = { entries, idx: 0 }
  return devNext(rt)
}

/** FillSort (+Lib.s:6274) compares name fields uppercased with '*' as
 * byte 1 — so directory entries bubble to the front */
function fillSortKey(s: string): string {
  let k = ''
  for (const c of s) k += c === '*' ? '\x01' : c.toUpperCase()
  return k
}

function devNext(rt: Runtime): string {
  const it2 = rt.devIter
  if (!it2 || it2.idx >= it2.entries.length) return ''
  return it2.entries[it2.idx++]!
}

function examinedFonts(rt: Runtime): typeof FONT_LIST {
  const mask = rt.fontsListed
  return FONT_LIST.filter((f) => (f.type === 'Rom' ? mask & 1 : mask & 2))
}

/**
 * Shift Up/Down delay,first,last[,flag] (ShD1 +Lib.s:9358): the 4th arg is
 * a wrap flag — flag 0 smears (Shf8a skips the wrap write), else the range
 * cycles. Omitted defaults to wrap (the common cycling case; the original's
 * omitted-arg polarity is unverified — see NOTES).
 */
function shiftArgs(it: It): { delay: number; first: number; last: number; wrap: boolean } {
  const delay = it.evalInt()
  it.expect(',')
  const first = it.evalInt()
  it.expect(',')
  const last = it.evalInt()
  const wrap = it.accept(',') ? it.evalInt() !== 0 : true
  return { delay: Math.max(1, delay), first, last, wrap }
}

/** Menu keyword index path: (n[,m[,k...]]) */
function menuPath(it: It): number[] {
  it.expect('(')
  const path = [it.evalInt()]
  while (it.accept(',')) path.push(it.evalInt())
  it.expect(')')
  return path
}

function menuNodeFlag(it: It, rt: Runtime, set: number, clear: number): void {
  // parens = a node path; a bare number = a whole level (MnDim +ILib.s:6996)
  if (it.nm() !== '(') {
    rt.menu.setLevelFlag(it.evalInt(), set, clear)
    return
  }
  const node = rt.menu.find(menuPath(it))
  if (node) {
    node.flags = (node.flags | set) & ~clear
    rt.menu.change = true
  }
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
  return rt.systemPattern(n)
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
      // EcCree +W.s:2910 masks the bitmap width down to a multiple of 16
      const w = it.evalInt() & ~15
      it.expect(',')
      const h = it.evalInt()
      it.expect(',')
      const nc = it.evalInt()
      it.expect(',')
      const mode = it.evalInt()
      rt.openScreen(n, w, h, nc, mode)
      // "Fait flasher la couleur 3 (si plus de 2 couleurs)" — only the
      // Screen Open instruction adds the system flash (+Lib.s:8989);
      // HAM (4096) is 6 planes so it qualifies
      if (nc === 4096 || nc > 2) rt.installSystemFlash()
    },
    'screen close'(it) {
      rt.closeScreen(optInt(it, rt.currentIndex))
    },
    default() {
      // InDefault +Lib.s:8710: back to the boot display — every screen
      // closed, screen 0 reopened with the default palette and the boot
      // cursor flash
      for (const n of [...rt.screens.keys()]) rt.closeScreen(n)
      rt.openScreen(0, 320, 200, 16, 0)
      rt.installSystemFlash()
    },
    'default palette'(it) {
      // InDefaultPalette +ILib.s:5389: colours for subsequently opened
      // screens; elided entries keep their current default
      let i = 0
      for (;;) {
        if (!(it.atStmtEnd() || it.nm() === ',')) {
          if (i < 32) rt.defaultPalette[i] = it.evalInt() & 0xfff
        }
        i++
        if (!it.accept(',')) break
      }
    },
    'dual playfield'(it) {
      // SetDual +W.s:2810: a = front (PF1), b = back (PF2). The back
      // screen is hidden (BitHide) and its pixels resolve through the
      // FRONT screen's palette entries 8-15, like the hardware. Checks:
      // different screens, neither already dual, same resolution + mode
      // (EcCon0 compared with the plane bits masked out), planes <= 3
      // each (2 in hires), and counts equal or the back one fewer.
      // (Error 70's exact message text is not in the source tree.)
      const a = it.evalInt()
      it.expect(',')
      const b = it.evalInt()
      const sa = rt.screens.get(a)
      const sb = rt.screens.get(b)
      if (!sa || !sb) throw new AmosError('screen not opened')
      const dualErr = (): never => {
        throw new AmosError('dual playfield impossible')
      }
      if (a === b || rt.dualPlayfield) dualErr()
      if (sa.hires !== sb.hires || sa.laced !== sb.laced) dualErr()
      const cap = sa.hires ? 2 : 3
      if (sa.depth > cap || sb.depth > cap) dualErr()
      if (!(sa.depth === sb.depth || sa.depth === sb.depth + 1)) dualErr()
      sb.visible = false // BitHide on the back screen
      rt.dualPlayfield = { front: a, back: b, pf2Front: false }
    },
    'dual priority'(it) {
      // DualP +W.s:2870: both screens must be in dual mode; the FIRST-
      // named screen's playfield comes to the front (BPLCON2 bit 6, PFBA)
      const a = it.evalInt()
      it.expect(',')
      const b = it.evalInt()
      if (!rt.screens.has(a) || !rt.screens.has(b)) throw new AmosError('screen not opened')
      const dp = rt.dualPlayfield
      if (!dp || !((dp.front === a && dp.back === b) || (dp.front === b && dp.back === a))) {
        throw new AmosError('screen not in dual playfield mode')
      }
      dp.pf2Front = a === dp.back
    },
    view() {
      // InView +Lib.s:9106: apply deferred display changes (CopMake)
      for (const s of rt.screens.values()) {
        if (rt.pendingView.has(s.index)) s.visible = true
      }
      rt.pendingView.clear()
    },
    'auto view on'() {
      rt.autoView = true
    },
    'auto view off'() {
      rt.autoView = false
    },
    screen(it) {
      rt.setCurrent(it.evalInt())
    },
    'screen display'(it) {
      // EcView +W.s:3276: n,x,y,w,h with per-arg keep-current; w/h set the
      // displayed-window size (EcAWTx/EcAWTy). It does NOT un-hide the screen.
      const s = byIndex(it.evalInt())
      if (it.accept(',')) {
        s.displayX = optInt(it, s.displayX)
        if (it.accept(',')) {
          s.displayY = optInt(it, s.displayY)
          if (it.accept(',')) {
            s.displayW = optInt(it, s.displayW)
            if (it.accept(',')) s.displayH = optInt(it, s.displayH)
          }
        }
      }
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
      // InCls +Lib.s:8722: no arg = clear the current WINDOW and home its
      // cursor (Clw); Cls c / region clears pixels without homing
      const s = scr()
      if (it.atStmtEnd()) {
        s.clw()
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
      // InBar +Lib.s:9975: x2<=x1 or y2<=y1 is a function call error
      const s = scr()
      const [x1, y1] = pair(it)
      it.expect('to')
      const [x2, y2] = pair(it)
      if (x2 <= x1 || y2 <= y1) throw new AmosError('Illegal function call', 23)
      s.bar(x1, y1, x2, y2)
      s.grX = x1 // InBar sets the graphics cursor to the top-left corner
      s.grY = y1
    },
    circle(it) {
      const s = scr()
      const [x, y] = pair(it)
      it.expect(',')
      const r = it.evalInt()
      if (r <= 0) throw new AmosError('function call error')
      // InCircle +Lib.s:9632: on a hires screen the x-radius is doubled so
      // the circle is round on non-square pixels
      s.ellipse(x, y, s.hires ? r * 2 : r, r)
      s.grX = x // the cursor ends at the centre
      s.grY = y
    },
    ellipse(it) {
      const s = scr()
      const [x, y] = pair(it)
      it.expect(',')
      const r1 = it.evalInt()
      it.expect(',')
      const r2 = it.evalInt()
      if (r1 <= 0 || r2 <= 0) throw new AmosError('function call error')
      s.ellipse(x, y, r1, r2)
      s.grX = x
      s.grY = y
    },
    polyline: polyish(false),
    polygon: polyish(true),
    paint(it) {
      // graphics.library Flood: mode 1 (default) fills the same-colour
      // region; mode 0 fills until the outline pen (Ink's 3rd argument)
      const s = scr()
      const [x, y] = pair(it)
      const mode = it.accept(',') ? it.evalInt() & 1 : 1
      s.paint(x, y, s.ink, mode === 0)
      s.grX = x
      s.grY = y
    },
    text(it) {
      // InText +Lib.s:9849: cursor to x,y then advanced by the string width
      const s = scr()
      const [x, y] = pair(it)
      it.expect(',')
      const str2 = it.evalStr()
      s.text(x, y, str2)
      s.grX = x + str2.length * 8
      s.grY = y
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
      rt.shifts.set(rt.currentIndex, { dir: 1, ...shiftArgs(it), count: 0 })
    },
    'shift down'(it) {
      rt.shifts.set(rt.currentIndex, { dir: -1, ...shiftArgs(it), count: 0 })
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
    'set font'(it) {
      // InSetFont +Lib.s:9835: negative errors; needs Get Fonts first
      // ("fonts not examined", error 37); Set Font 0 is a silent no-op
      // (TSFont +W.s:4922); an unknown number is "font not available"
      const n = it.evalInt()
      if (n < 0) throw new AmosError('Illegal function call', 23)
      if (!rt.fontsListed) throw new AmosError('fonts not examined')
      if (n === 0) return
      if (!examinedFonts(rt)[n - 1]) throw new AmosError('font not available')
      rt.currentFont = n
    },
    // InGetFonts/Igf +Lib.s:9772: d1 mask 3/1/2 selects rom+disc, rom
    // only, disc only; Font$/Set Font see the filtered list
    'get fonts'() {
      rt.fontsListed = 3
    },
    'get rom fonts'() {
      rt.fontsListed = 1
    },
    'get disc fonts'() {
      rt.fontsListed = 2
    },
    'request on'() {
      rt.requestMode = 1
    },
    'request off'() {
      rt.requestMode = 0
    },
    'request wb'() {
      rt.requestMode = 2
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
      // positive patterns come from the machine mouse bank (SPat +W.s:4730)
      s.pattern = rt.systemPattern(n)
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
      // FlStop (+W.s:5285): stops the flashes of the ACTIVE screen only
      rt.flashOff()
    },
    flash(it) {
      const reg = it.evalInt()
      it.expect(',')
      const spec = it.evalStr()
      const seq = parseFlashSpec(spec)
      // flsynt (+W.s:5333): a bad string still clears the colour's entry,
      // then errors (code 8 → message 52, "Flash declaration error")
      if (seq === null) {
        rt.flashStop(reg)
        throw new AmosError('flash declaration error')
      }
      // Flash n,"" is the documented way to stop one colour — no error
      if (seq.length === 0) {
        rt.flashStop(reg)
        return
      }
      rt.flashStart(reg, seq)
    },

    // ---- rainbows (TRSet/TRDo/TRVar/TRDel, +W.s:3916-4170) ----
    'set rainbow'(it) {
      // Set Rainbow n,colour,length,r$,g$,b$[,seed]: builds the 12-bit
      // table once, via three per-channel wave machines (Trs1/Trs2).
      // Bounds from InSetRainbow7 +Lib.s:9385: n < 4, 16 <= length < 32700;
      // the colour is masked &31 THEN must be < PalMax=16 (TRSet +W.s:3999)
      // — so colour 33 legally wraps to 1. The optional 7th value seeds the
      // three channel nibbles (R=bits 8-11, G=4-7, B=0-3).
      const n = it.evalInt()
      it.expect(',')
      const colour = it.evalInt()
      it.expect(',')
      const len = it.evalInt()
      it.expect(',')
      const rs = it.evalStr()
      it.expect(',')
      const gs = it.evalStr()
      it.expect(',')
      const bs = it.evalStr()
      const seed = it.accept(',') ? it.evalInt() : 0
      if (n >>> 0 >= 4) throw new AmosError('function call error')
      if (len < 16 || len >= 32700) throw new AmosError('function call error')
      if (colour < 0) throw new AmosError('function call error')
      const c = colour & 31
      if (c >= 16) throw new AmosError('function call error')
      let table: Uint16Array
      try {
        table = buildRainbowTable(len, seed, rs, gs, bs)
      } catch {
        // TrSynt deletes the half-made rainbow and errors (+W.s:4113)
        rt.rainbows.delete(n)
        throw new AmosError('function call error')
      }
      // fresh entry: nothing displayed until a Rainbow instruction (RnI=-1)
      rt.rainbows.set(n, { colour: c, table, base: 0, x: 0, y: 0, h: -1, act: 0, dy: 0, fy: 0, ty: 0 })
    },
    rainbow(it) {
      // Rainbow n[,base][,y][,h] (TRDo +W.s:3940): elided values keep the
      // current ones; changes are latched as RnAct bits and folded in at
      // the next copper build. Errors report as OUT OF MEMORY — RainEr
      // returns 1, which EcWiErr maps to L_OOfMem (+Lib.s).
      const n = it.evalInt()
      const rb = rt.rainbows.get(n)
      if (n >>> 0 >= 4 || !rb || rb.table.length === 0) throw new AmosError('out of memory')
      it.expect(',')
      if (!(it.atStmtEnd() || it.nm() === ',')) {
        rb.x = it.evalInt()
        rb.act |= 2
      }
      if (it.accept(',')) {
        if (!(it.atStmtEnd() || it.nm() === ',')) {
          rb.y = it.evalInt()
          rb.act |= 4
        }
        if (it.accept(',') && !it.atStmtEnd()) {
          // the tutorial writes `Rainbow N,Y,,` — trailing elision keeps h
          rb.h = it.evalInt()
          rb.act |= 1
        }
      }
    },
    'rainbow del'(it) {
      // TRDel +W.s:4160: no argument clears every rainbow
      if (it.atStmtEnd()) rt.rainbows.clear()
      else rt.rainbows.delete(it.evalInt())
    },

    // ---- user copper (TCop* +W.s:6815-6935) ----
    'copper on'() {
      rt.copperOnOff(true)
    },
    'copper off'() {
      rt.copperOnOff(false)
    },
    'cop swap'() {
      rt.copSwapUser()
    },
    'cop reset'() {
      rt.copResetUser()
    },
    'cop wait'(it) {
      // Cop Wait x,y[,xmask,ymask] — masks default -1 (InCopWait2 +Lib.s:9487)
      const x = it.evalInt()
      it.expect(',')
      const y = it.evalInt()
      let mx = -1
      let my = -1
      if (it.accept(',')) {
        mx = it.evalInt()
        it.expect(',')
        my = it.evalInt()
      }
      rt.copWait(x, y, mx, my)
    },
    'cop move'(it) {
      const reg = it.evalInt()
      it.expect(',')
      rt.copMove(reg, it.evalInt())
    },
    'cop movel'(it) {
      const reg = it.evalInt()
      it.expect(',')
      rt.copMoveL(reg, it.evalInt())
    },
    rain(it) {
      // assignment form: Rain(n,line) = colour (TRVar +W.s:3966: bounds
      // checked, the value masked to 12 bits; errors are OUT OF MEMORY
      // via EcWiErr, like Rainbow)
      it.expect('(')
      const n = it.evalInt()
      it.expect(',')
      const line = it.evalInt()
      it.expect(')')
      it.expectOp('=')
      const v = it.evalInt()
      const rb = rt.rainbows.get(n)
      if (n >>> 0 >= 4 || !rb || rb.table.length === 0 || line < 0 || line >= rb.table.length)
        throw new AmosError('out of memory')
      rb.table[line] = v & 0xfff
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
      // InCursPen +Lib.s:13330: the cursor colour register (WiCuCol)
      scr().curWin.cuCol = it.evalInt()
    },
    'curs on'() {
      scr().cursorOn = true // InCursOn +Lib.s:13418 (WiSys bit1)
    },
    'curs off'() {
      scr().cursorOn = false
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
      // WiSize +W.s:13970: resize, redraw the frame, then Clw the interior
      // (the window is blanked to paper and the cursor homed)
      const s = scr()
      const [w2, h2] = pair(it)
      s.curWin.cols = w2
      s.curWin.rows = h2
      s.drawWindowFrame2()
      s.clw()
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

    // ---- pointer visibility (MHide/MShow +W.s:10722, both no-ops under
    // Copper Off): a counter, visible while >= 0; Hide/Show step it,
    // the On forms force -1 / 0 ----
    hide: () => {
      if (rt.copperOn) rt.mouseShow--
    },
    'hide on': () => {
      if (rt.copperOn) rt.mouseShow = -1
    },
    show: () => {
      if (rt.copperOn) rt.mouseShow++
    },
    'show on': () => {
      if (rt.copperOn) rt.mouseShow = 0
    },
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
      // Appear src To dst,e[,p] (InAppear +Lib.s:10466): p iterations
      // (default = every pixel) stepping (e mod p) through the source
      // pixel index space, copying only the planes both screens share and
      // preserving the destination's higher planes. gcd(e, total) > 1
      // leaves pixels uncopied — the classic venetian/checker dissolves.
      const src = rt.resolveScreenId(it.evalInt())
      it.expect('to')
      const dst = rt.resolveScreenId(it.evalInt())
      it.expect(',')
      const e = it.evalInt()
      const p = it.accept(',') ? it.evalInt() : 0
      if (e <= 0 || p < 0) throw new AmosError('function call error')
      const s = src.s
      const d = dst.s
      const total = s.rowBytes * 8 * s.height
      const count = p === 0 ? total : p
      let step = e
      while (step >= count) step -= count
      const mask = (1 << Math.min(s.depth, d.depth)) - 1
      let idx = 0
      for (let i = 0; i < count; i++) {
        idx += step
        if (idx >= total) idx -= total
        const byte = idx >> 3
        const row = Math.floor(byte / s.rowBytes)
        if (row >= d.height) continue
        const byteInRow = byte % s.rowBytes
        if (byteInRow >= d.rowBytes) continue
        const x = byteInRow * 8 + (idx & 7)
        if (x >= s.width || x >= d.width) continue
        const v = src.buf[row * s.width + x]! & mask
        const di = row * d.width + x
        dst.buf[di] = (dst.buf[di]! & ~mask) | v
      }
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
    // ---- Update family (InUpdate* +Lib.s:11452-11527): both pipelines ----
    'update on'() {
      rt.bobUpdateOn = true
      rt.spriteUpdateOn = true
    },
    'update off'() {
      rt.bobUpdateOn = false
      rt.spriteUpdateOn = false
    },
    update() {
      // one manual round: bobs erase/draw + buffer swap + sprites
      rt.updateBobs()
    },
    'update every'(it) {
      // InUpdateEvery: the auto update runs every n VBLs (VBLDelai)
      const n = it.evalInt()
      if (n >= 65536) throw new AmosError('function call error')
      rt.updateEvery = Math.max(1, n)
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
      // InLimitMouse (+Lib.s:12330): no args = the current screen's display
      // area; `Limit Mouse n` = screen n's; `Limit Mouse x1,y1 To x2,y2` =
      // a hardware-coordinate rectangle. Clamped every vbl (LimitMEc).
      const screenRect = (s: Screen): { x1: number; y1: number; x2: number; y2: number } => {
        const winW = s.displayW >= 0 ? Math.min(s.displayW, s.width) : s.width
        const winH = s.displayH >= 0 ? Math.min(s.displayH, s.height) : s.height
        const hwW = winW >> (s.hires ? 1 : 0)
        const hwH = s.laced ? Math.ceil(winH / 2) : winH
        return { x1: s.displayX, y1: s.displayY, x2: s.displayX + hwW - 1, y2: s.displayY + hwH - 1 }
      }
      if (it.atStmtEnd()) {
        rt.mouseLimit = screenRect(rt.screen)
        return
      }
      const a = it.evalInt()
      if (!it.accept(',')) {
        const s = rt.screens.get(a)
        if (!s) throw new AmosError(`screen not opened: ${a}`)
        rt.mouseLimit = screenRect(s)
        return
      }
      const y1 = it.evalInt()
      it.expect('to')
      const x2 = it.evalInt()
      it.expect(',')
      const y2 = it.evalInt()
      rt.mouseLimit = { x1: a, y1, x2, y2 }
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
    'put bob'(it) {
      // InPutBob +Lib.s:12723: stamp a live displayed bob permanently into
      // its screen background at its current position/image
      const n = it.evalInt()
      const bob = rt.bobs.get(n)
      if (!bob) return
      const img = rt.spriteBank?.image(bob.image)
      if (!img) return
      const s = rt.screens.get(bob.screen) ?? scr()
      rt.blit(s, img, bob.x - img.hotX, bob.y - img.hotY, img.opaque)
    },
    'put key'(it) {
      // InPutKey +Lib.s:13724: append a string to the keyboard buffer
      const s2 = it.evalStr()
      if (s2.length >= 64) throw new AmosError('string too long')
      for (const ch of s2) rt.pressKey(ch, 0)
    },
    'del bob': delObj('sprite'),
    'del sprite': delObj('sprite'),
    'del icon': delObj('icon'),
    'ins bob': insObj('sprite'),
    'ins sprite': insObj('sprite'),
    'ins icon': insObj('icon'),
    'make icon mask'(it) {
      if (!it.atStmtEnd()) it.evalInt() // masks are implicit here
    },
    'no icon mask'(it) {
      const img = rt.iconBank?.image(it.atStmtEnd() ? 1 : it.evalInt())
      if (img) img.opaque = true
    },
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
      // InSprite +Lib.s:12315 → HsNxya: n in 0..63; omitted args keep the
      // previous value (each compared to EntNul)
      const n = it.evalInt()
      if (n < 0 || n >= 64) throw new AmosError('illegal sprite number')
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
      // InSpriteUpdate +Lib.s:11508: apply buffered changes now (ActHs+AffHs)
      it.skipToStmtEnd()
      if (!rt.spriteUpdateOn) rt.frozenSprites = [...rt.hwSprites.values()].map((s) => ({ ...s }))
    },
    'sprite priority'(it) {
      // InSpritePriority → HsPri (+W.s:11374): pokes BPLCON2 PF2P — pairs
      // BELOW the value show in front of the playfield. 4 (the EcCon2
      // default) = all sprites in front; 0 = all behind.
      const p = it.evalInt()
      if (p < 0 || p > 4) throw new AmosError('function call error')
      rt.spritePriority = p
    },
    'set sprite buffer'(it) {
      // InSetSpriteBuffer +Lib.s:12290: scanlines per multiplexer slot, must
      // be >= 16 (cmp #16 / bcs error). A resource knob with no visible
      // effect in the chunky renderer.
      const n = it.evalInt()
      if (n < 16) throw new AmosError('function call error')
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
        // Unpack_Screen prints Esc"C0" to the new screen — cursor off, and
        // no system flash either (+Lib.s:25520-25552)
        s.cursorOn = false
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
      // the value stays a raw long in the 68k — a string reaches a string
      // edit zone as its pointer, so carry either type through
      let v: number | string | null = null
      let p4: number | null = null
      let p5: number | null = null
      if (it.accept(',')) {
        if (!it.atStmtEnd() && it.nm() !== ',') {
          const raw = it.evalExpr()
          v = raw.k === 'str' ? raw.s : int(raw)
        }
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
        // +Interpreter_Config.s:186, system message 46, on the new
        // (current) screen's chosen colour
        rt.flashStart(flash & 31, parseFlashSpec(DEFAULT_FLASH_SPEC)!)
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
      // an AmBs bank list erases ALL banks first (LB_Multiples: Bnk.EffAll,
      // +Lib.s Bnk.Load)
      if (file.bankList) {
        rt.memBanks.clear()
        rt.spriteBank = null
        rt.iconBank = null
      }
      // a forced number applies only to a single-bank load; a multi-bank
      // container restores each bank to its own stored number (Bnk.Load
      // +Lib.s:4054) — forcing every bank would collide them
      const single = file.banks.length === 1
      for (const bank of file.banks) {
        if (bank.kind === 'sprites' || bank.kind === 'icons') {
          // LB_Sprites/LB_Icons: a nonzero (or defaulted) bank argument
          // APPENDS to an existing bank and the file's palette wins;
          // 0 overwrites
          const nb = ObjectBank.fromSpriteBank(bank)
          const slot = bank.kind === 'sprites' ? 'spriteBank' : ('iconBank' as const)
          const cur = rt[slot]
          if (cur && forced !== 0) {
            cur.images.push(...nb.images)
            cur.palette = nb.palette
          } else rt[slot] = nb
        } else if (bank.kind === 'memory') rt.memBanks.set(single && forced !== null ? forced : bank.number || 5, bank)
      }
    },
    // ---- audio ----
    'sam bank'(it) {
      // InSamBank +Music.s:3034: 1-16, else illegal function call
      const n = it.evalInt()
      if (n <= 0 || n > 16) throw new AmosError('Illegal function call', 23)
      rt.samBankNum = n
    },
    'sam play'(it) {
      // Sam Play n | Sam Play voices,n | Sam Play voices,n,freq
      // (InSamPlay1-3 +Music.s:3128: an explicit frequency <=500 errors)
      const a = it.evalInt()
      let mask = 0b1111
      let n = a
      let freq: number | null = null
      if (it.accept(',')) {
        mask = a
        n = it.evalInt()
        if (it.accept(',')) freq = it.evalInt()
      }
      if (freq !== null && freq <= 500) throw new AmosError('Illegal function call', 23)
      const sample = rt.getSample(n)
      rt.samPlay(mask & 15, sample.pcm, freq ?? sample.freq)
    },
    'sam stop'(it) {
      rt.stopVoices((it.atStmtEnd() ? 0b1111 : it.evalInt()) & 15)
    },
    'sam swap'(it) {
      // InSamSwap +Music.s:4080: Sam Swap voices To address,length —
      // queues the next buffer, picked up when the playing one ends
      const mask = it.evalInt()
      it.expect('to')
      const addr = it.evalInt()
      it.expect(',')
      const len = it.evalInt()
      if (len < 0) throw new AmosError('Illegal function call', 23)
      const m = rt.bankOrAddr(addr)
      if (!m) return
      const pcm = new Int8Array(m.data.buffer, m.data.byteOffset + m.off, Math.min(len, m.data.length - m.off))
      rt.music.samSwap(mask & 15, pcm)
    },
    sload(it) {
      // InSload +Music.s:3239: Sload f To address,length — reads raw
      // bytes from an open sequential channel into memory
      const ch = it.evalInt()
      it.expect('to')
      const addr = it.evalInt()
      it.expect(',')
      const len = it.evalInt()
      if (len < 0 || ch < 1 || ch > 10) throw new AmosError('Illegal function call', 23)
      const c = rt.fileChans.get(ch)
      if (!c || c.mode !== 'in') throw new AmosError('Illegal function call', 23)
      const m = rt.resolveWrite(addr)
      if (!m) return
      const n = Math.min(len, c.data.length - c.pos, m.data.length - m.off)
      for (let i = 0; i < n; i++) m.data[m.off + i] = c.data[c.pos + i]!
      c.pos += n
    },
    ssave(it) {
      // InSsave +Music.s:4426: Ssave f,start To end — end must be past
      // start; writes the raw bytes to an open output channel
      const ch = it.evalInt()
      it.expect(',')
      const start = it.evalInt()
      it.expect('to')
      const end = it.evalInt()
      if (end - start <= 0 || ch < 1 || ch > 10) throw new AmosError('Illegal function call', 23)
      const c = rt.fileChans.get(ch)
      if (!c || c.mode !== 'out') throw new AmosError('Illegal function call', 23)
      const m = rt.resolveAddr(start)
      if (!m) return
      const n = Math.min(end - start, m.data.length - m.off)
      for (let i = 0; i < n; i++) c.out.push(m.data[m.off + i]!)
    },
    'sam loop on'(it) {
      // SL0 +Music.s:3073: updates the mask AND re-points live samples
      const mask = (it.atStmtEnd() ? 0b1111 : it.evalInt()) & 15
      rt.samLoopMask |= mask
      for (let v = 0; v < 4; v++) if (mask & (1 << v)) rt.audio.setLoop(v, 0)
    },
    'sam loop off'(it) {
      const mask = (it.atStmtEnd() ? 0b1111 : it.evalInt()) & 15
      rt.samLoopMask &= ~mask
      for (let v = 0; v < 4; v++) if (mask & (1 << v)) rt.audio.setLoop(v, -1)
    },
    volume(it) {
      // InVolume1/2 +Music.s:2739: the one-argument form also sets the
      // music master volume (L_MVol); out-of-range volume errors in Vol
      const a = it.evalInt()
      if (it.accept(',')) {
        rt.setVolume(a & 15, it.evalInt())
      } else {
        rt.setVolume(0b1111, a)
        rt.musicVolume = a & 63
        rt.music.setMusicVolume()
      }
    },
    bell(it) {
      // InBell +Music.s:2681: the square wave (1) with EnvBell on all
      // four voices; default note 70
      rt.music.playNote(0b1111, it.atStmtEnd() ? 70 : it.evalInt(), 1, ENV_BELL)
    },
    shoot() {
      // InShoot +Music.s:2713: noise notes 60..63, one per voice
      rt.music.shout(60, ENV_SHOOT)
    },
    boom() {
      // InBoom +Music.s:2702: noise notes 36..39 with the boom envelope
      rt.music.shout(36, ENV_BOOM)
    },
    play(it) {
      // InPlay2/3 +Music.s:2802: Play [voices,]note,wait — a negative
      // wait errors; a positive one behaves as Wait n after starting
      const a = it.evalInt()
      it.expect(',')
      const b = it.evalInt()
      let mask = 0b1111
      let note = a
      let wait = b
      if (it.accept(',')) {
        mask = a & 15
        note = b
        wait = it.evalInt()
      }
      if (wait < 0) throw new AmosError('Illegal function call', 23)
      rt.music.playNote(mask, note)
      if (wait > 0) it.block({ type: 'wait', until: it.tick + wait })
    },
    'play off'(it) {
      // InPlayOff +Music.s:2977 -> EnvOff
      rt.music.playOff((it.atStmtEnd() ? 0b1111 : it.evalInt()) & 15)
    },
    'set wave'(it) {
      // InSetWave +Music.s:3387: needs at least 256 characters (error
      // 181), wave 0 illegal; the first 256 bytes become the waveform
      const n = it.evalInt()
      it.expect(',')
      const s = it.evalStr()
      if (s.length < 256) throw new AmosError('256 characters for a wave')
      if (n <= 0) throw new AmosError('Illegal function call', 23)
      const src = new Int8Array(256)
      for (let i = 0; i < 256; i++) src[i] = (s.charCodeAt(i) << 24) >> 24
      rt.music.setWave(n, src)
    },
    'del wave'(it) {
      // InDelWave +Music.s:3405: waves 0 and 1 are reserved (error 182);
      // deleting resets every voice to wave 1
      const n = it.evalInt()
      if (n < 0) throw new AmosError('Illegal function call', 23)
      if (n === 0 || n === 1) throw new AmosError('wave 0 and 1 are reserved')
      rt.music.delWave(n)
    },
    'set envel'(it) {
      // InSetEnvel +Music.s:3426: Set Envel wave,phase To duration,volume;
      // a negative duration in phases 1-6 loops the envelope
      const wave = it.evalInt()
      it.expect(',')
      const phase = it.evalInt()
      it.expect('to')
      const dur = it.evalInt()
      it.expect(',')
      const vol = it.evalInt()
      if (vol < 0 || vol >= 64) throw new AmosError('Illegal function call', 23)
      if (phase < 0 || phase >= 7) throw new AmosError('Illegal function call', 23)
      if (wave < 0) throw new AmosError('Illegal function call', 23)
      if (phase === 0 && dur <= 0) throw new AmosError('Illegal function call', 23)
      rt.music.setEnvel(wave, phase, dur, vol)
    },
    wave(it) {
      // InWave +Music.s:3373: Wave n To voices
      const n = it.evalInt()
      if (n < 0) throw new AmosError('Illegal function call', 23)
      it.expect('to')
      rt.music.waveTo(n, it.evalInt() & 15)
    },
    'noise to'(it) {
      // InNoiseTo +Music.s:3093
      rt.music.noiseTo(it.evalInt() & 15)
    },
    sample(it) {
      // InSampleTo +Music.s:3102: Sample n To voices
      const n = it.evalInt()
      it.expect('to')
      rt.music.sampleTo(n, it.evalInt() & 15)
    },
    voice(it) {
      // InVoice +Music.s:3754: mask &15 -> VOnOf; only acts while a
      // music is playing (stops/reclaims the player's voices)
      rt.music.voiceOnOff(it.evalInt() & 15)
    },
    music(it) {
      // InMusic +Music.s:3815: song from the bank-3 music bank; up to
      // 3 musics stack, a full stack ignores the call
      rt.music.music(it.evalInt())
    },
    'music off'() {
      rt.music.musicOff()
    },
    'music stop'() {
      // InMusicStop +Music.s:3701: zero the voice counters — the player
      // pops the music stack at the next step-tick
      rt.music.musicStop()
    },
    tempo(it) {
      // InTempo +Music.s:3878: 0-100 (unsigned compare), only affects a
      // playing music
      const t = it.evalInt()
      if (t < 0 || t > 100) throw new AmosError('Illegal function call', 23)
      rt.music.tempo(t)
    },
    mvolume(it) {
      // InMvolume +Music.s:3720: >=64 errors; rescales all stacked musics
      const v = it.evalInt()
      if (v < 0 || v >= 64) throw new AmosError('Illegal function call', 23)
      rt.musicVolume = v & 63
      rt.music.setMusicVolume()
    },
    'track load'(it) {
      // InTrackLoad +Music.s:4120: the whole file into a chip bank named
      // "Tracker "; reloading the currently playing bank stops it first
      const path = it.evalStr()
      it.expect(',')
      const n = it.evalInt()
      if (n < 1 || n >= 0x10000) throw new AmosError('Illegal function call', 23)
      if (n === rt.music.trackBank && rt.music.mtOn) rt.music.trackStop()
      rt.music.trackBank = n
      const bytes = rt.fs?.read(path)
      if (!bytes) throw new AmosError(`file not found: ${path}`)
      rt.memBanks.set(n, { kind: 'memory', number: n, memType: 1, name: 'Tracker', flags: 0, data: bytes })
    },
    'track play'(it) {
      // InTrackPlay0-2 +Music.s:4266: bank defaults to Track_Bank; the
      // pattern argument is "not supported in this version" there either
      let bank: number | null = null
      if (!it.atStmtEnd()) {
        if (it.nm() !== ',') bank = it.evalInt()
        if (it.accept(',')) it.evalInt()
      }
      rt.music.trackPlay(bank)
    },
    'track stop'() {
      rt.music.trackStop()
    },
    run(it) {
      // InRun0/1 +ILib.s:1465: bare Run only works in direct mode —
      // inside a program it is a syntax error; Run "file" chains to the
      // new program (screens kept, banks replaced by the file's)
      if (it.atStmtEnd()) throw new AmosError('syntax error')
      rt.runFile(it.evalStr())
      return 'jumped'
    },
    system(it) {
      // InSystem +ILib.s:1849: run-error 1002 — leave AMOS entirely; in
      // the port, like Edit/Direct, the program simply ends
      it.halt('ended')
      return 'jumped'
    },
    // AMOS_WB window juggling (+Lib.s:11361): a single-display host has
    // nothing to raise or lower — AMOS is always at the front
    'amos to front': () => {},
    'amos to back': () => {},
    'amos lock'() {
      rt.noFlip = true // InAmosLock: to front + T_NoFlip
    },
    'amos unlock'() {
      rt.noFlip = false
    },
    'close workbench'() {
      // WB_Close frees Workbench memory on the Amiga; nothing to close
    },
    'close editor'() {
      // Ed_CloseEditor frees the editor; there is no editor in the port
    },
    'set buffer'(it) {
      // InSetBuffer +ILib.s:1828 is literally rts in the interpreter —
      // the buffer size only matters to the editor/compiler at load time
      it.evalInt()
    },
    'iff anim'(it) {
      // InIffAnim +Lib.s:4538: Iff Anim "file",screen[,times] — the
      // whole ANIM loads, frame 1 creates and double-buffers the
      // screen, then each frame waits the ANHD time, swaps, and plays
      // the next DLTA into the logical buffer (which is what makes
      // ANIM5's two-frames-back deltas land correctly)
      const path = it.evalStr()
      it.expect(',')
      const screen = it.evalInt()
      const times = it.accept(',') ? it.evalInt() : 1
      if (times < 0) throw new AmosError('Illegal function call', 23)
      if (!rt.iffAnim) {
        const bytes = rt.fs?.read(path)
        if (!bytes) throw new AmosError(`file not found: ${path}`)
        const data = Uint8Array.from(bytes)
        const { bytes: size } = formSize(data, 0, 32767)
        const buf = new Uint8Array(size + 8)
        formLoad(data, 0, 32767, buf)
        if (String.fromCharCode(buf[8]!, buf[9]!, buf[10]!, buf[11]!) !== 'ILBM') throw new AmosError('bad IFF format')
        const pos = formPlay(rt, buf, 0, 1, screen, false)
        rt.screen.doubleBuffer()
        rt.iffAnim = { buf, pos, firstPos: pos, remaining: times, nextDue: it.tick + Math.max(1, rt.iffReturn + 1) }
      }
      const st = rt.iffAnim
      while (it.tick >= st.nextDue) {
        rt.screen.swap()
        if (String.fromCharCode(st.buf[st.pos]!, st.buf[st.pos + 1]!, st.buf[st.pos + 2]!, st.buf[st.pos + 3]!) === 'AenD') {
          if (--st.remaining > 0) {
            st.pos = st.firstPos
          } else {
            rt.iffAnim = null
            return
          }
        }
        st.pos = formPlay(rt, st.buf, st.pos, 1, null, false)
        st.nextDue = it.tick + Math.max(1, rt.iffReturn + 1)
      }
      it.block({ type: 'wait', until: st.nextDue }, true)
      return 'jumped'
    },
    'med load'(it) {
      // InMedLoad +Music.s:4456: whole file into a chip bank "Med     ";
      // a bad magic erases the bank and raises error 189
      const path = it.evalStr()
      it.expect(',')
      const n = it.evalInt()
      if (n < 1 || n >= 0x10000) throw new AmosError('Illegal function call', 23)
      if (n === rt.music.med.bank) rt.music.med.stop()
      rt.music.med.bank = n
      const bytes = rt.fs?.read(path)
      if (!bytes) throw new AmosError(`file not found: ${path}`)
      rt.memBanks.set(n, { kind: 'memory', number: n, memType: 1, name: 'Med', flags: 0, data: bytes })
      const magic = String.fromCharCode(...bytes.slice(0, 4))
      if (magic !== 'MMD0' && magic !== 'MMD1') {
        rt.memBanks.delete(n)
        throw new AmosError('not a med module')
      }
    },
    'med play'(it) {
      // InMedPlay0-2 +Music.s:4603: Med Play [bank][,song] — the bank is
      // verified first, then samples/tracker/med all stop before the start
      let bank: number | null = null
      let song = 0
      if (!it.atStmtEnd()) {
        if (it.nm() !== ',') bank = it.evalInt()
        if (it.accept(',')) song = it.evalInt()
      }
      rt.music.med.stop()
      const n = rt.music.med.checkBank(bank)
      rt.stopVoices(0b1111)
      rt.music.trackStop()
      rt.music.med.play(n, song)
    },
    'med stop'() {
      rt.music.med.stop()
    },
    'med cont'() {
      rt.music.med.cont()
    },
    'med midi on'() {
      // InMedMidiOn +Music.s:4702: flag only — no MIDI output in the port
      rt.music.med.midi = true
    },
    'track loop on'() {
      rt.music.trackLoop = true
    },
    // the original token table really does spell it with one f
    // ("track loop o","f"+$80 — +Music.s:503)
    'track loop of'() {
      rt.music.trackLoop = false
    },
    // InLedOn/Of +Music.s:3917: $BFE001 bit 1 — LED lit = low-pass filter engaged
    'led on': () => rt.audio.setFilter(true),
    'led off': () => rt.audio.setFilter(false),

    // ---- menus ----
    'menu$'(it) {
      // InMenu +ILib.s:6856: Menu$(path)=normal$[,highlight$][,inactive$]
      // [,background$] — labels compile to display objects (MnObjet)
      const path = menuPath(it)
      it.expectOp('=')
      const node = rt.menu.insert(path)
      const w = rt.screen.curWin
      node.inks1 = [w.paper, w.pen, w.paper]
      node.inks2 = [w.pen, w.paper, w.paper]
      node.ob1 = compileMenuObject(it.evalStr())
      node.ob2 = it.accept(',') ? compileMenuObject(it.evalStr()) : null
      node.ob3 = it.accept(',') ? compileMenuObject(it.evalStr()) : null
      node.obF = it.accept(',') ? compileMenuObject(it.evalStr()) : null
      if (rt.menu.screenNb < 0) rt.menu.screenNb = rt.currentIndex
    },
    'menu on'(it) {
      void it
      rt.menu.on = true
    },
    'menu off'() {
      rt.menu.on = false
    },
    'menu calc'() {
      menuCalc(rt.menu)
    },
    'menu base'(it) {
      // MnBase +Lib.s:15624 — EntNul-style elision keeps a coordinate
      const x = it.atStmtEnd() || it.nm() === ',' ? null : it.evalInt()
      if (it.accept(',')) {
        const y = it.atStmtEnd() ? null : it.evalInt()
        if (y !== null) rt.menu.baseY = y
      }
      if (x !== null) rt.menu.baseX = x
      rt.menu.change = true
    },
    'menu movable'(it) {
      rt.menu.setLevelFlag(optInt(it, 1), MF_TBOUGE, 0)
    },
    'menu static'(it) {
      rt.menu.setLevelFlag(optInt(it, 1), 0, MF_TBOUGE)
    },
    'menu item movable'(it) {
      rt.menu.setLevelFlag(optInt(it, 1), MF_BOUGE, 0)
    },
    'menu item static'(it) {
      rt.menu.setLevelFlag(optInt(it, 1), 0, MF_BOUGE)
    },
    'menu bar'(it) {
      // level layout styles (+Lib.s:15682): bar = vertical column
      rt.menu.setLevelFlag(optInt(it, 1), MF_BAR, 0)
    },
    'menu line'(it) {
      rt.menu.setLevelFlag(optInt(it, 1), 0, MF_BAR | MF_TOTAL)
    },
    'menu tline'(it) {
      rt.menu.setLevelFlag(optInt(it, 1), MF_TOTAL, MF_BAR)
    },
    'menu active'(it) {
      menuNodeFlag(it, rt, 0, MF_OFF)
    },
    'menu inactive'(it) {
      menuNodeFlag(it, rt, MF_OFF, 0)
    },
    'menu separate'(it) {
      // MnDim addresses either a node path (parens) or a whole level
      menuNodeFlag(it, rt, MF_SEP, 0)
    },
    'menu link'(it) {
      menuNodeFlag(it, rt, 0, MF_SEP)
    },
    'menu called'(it) {
      const node = rt.menu.find(menuPath(it))
      if (node) node.called = true
    },
    'menu once'(it) {
      const node = rt.menu.find(menuPath(it))
      if (node) node.called = false
    },
    'menu del'(it) {
      // InMenuDel +ILib.s:6954: no path = wipe the whole tree
      if (it.atStmtEnd()) {
        rt.menu.reset()
        return
      }
      rt.menu.delete(menuPath(it))
    },
    'menu mouse on'() {
      rt.menu.mouse = true
    },
    'menu mouse off'() {
      rt.menu.mouse = false
    },
    'set menu'(it) {
      // InSetMenu +ILib.s:6973: Set Menu(path) To x,y — fixed position
      const node = rt.menu.insert(menuPath(it))
      it.expect('to')
      node.x = it.evalInt()
      it.expect(',')
      node.y = it.evalInt()
      node.flags |= MF_FIXED
      rt.menu.change = true
    },
    'menu key'(it) {
      // InMenuKey +ILib.s:6760: Menu Key(path) To k$ (ASCII, first char of
      // a non-empty string) or To scan[,shift] (numeric, scan < 128,
      // shift < 256); leaf nodes only; NO To clears the key (IMnk2)
      const node = rt.menu.find(menuPath(it))
      if (node && node.children.length > 0) throw new AmosError('function call error')
      if (!it.accept('to')) {
        if (node) node.key = { kind: 0, asc: 0, scan: 0, shift: 0 }
        return
      }
      const v = it.evalExpr()
      if (v.k === 'str') {
        if (v.s.length === 0) throw new AmosError('function call error')
        if (node) node.key = { kind: 1, asc: v.s.charCodeAt(0), scan: 0, shift: 0 }
        return
      }
      const scan = int(v)
      const shift = it.accept(',') ? it.evalInt() : 0
      if (shift >>> 0 >= 256 || scan >>> 0 >= 128) throw new AmosError('function call error')
      if (node) node.key = { kind: -1, asc: 0, scan, shift }
    },
    'menu to bank'(it) {
      // +Lib.s:15401: serialise the tree as a "Menu    " bank
      const n = it.evalInt()
      rt.memBanks.set(n, {
        kind: 'memory',
        number: n,
        memType: 0,
        name: 'Menu    ',
        flags: 0,
        data: menuToBank(rt.menu),
      })
    },
    'bank to menu'(it) {
      // +Lib.s:15494: load a tree from a menu bank
      const n = it.evalInt()
      const bank = rt.memBanks.get(n)
      if (!bank || !/^menu/i.test(bank.name)) throw new AmosError('bank not reserved')
      bankToMenu(rt.menu, bank.data)
      if (rt.menu.screenNb < 0) rt.menu.screenNb = rt.currentIndex
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
      const clone = rt.openScreen(n, src.width, src.height, src.ham ? 4096 : src.nColors, (src.hires ? 0x8000 : 0) | (src.laced ? 4 : 0))
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
      // InHScroll +Lib.s:13544: n in 1..4 prints window control code 15+n
      // — the scroll itself is the escape-code handler (ScG*/ScD*
      // +W.s:14539), so Print Chr$(16) does the same thing
      const n = it.evalInt()
      if (n < 1 || n > 4) throw new AmosError('function call error')
      scr().writeText(String.fromCharCode(15 + n))
    },
    'vscroll'(it) {
      // InVScroll +Lib.s:13552: codes 19+n (ScBas/ScBasHaut/ScHaut/
      // ScHautBas +W.s:14657-14760)
      const n = it.evalInt()
      if (n < 1 || n > 4) throw new AmosError('function call error')
      scr().writeText(String.fromCharCode(19 + n))
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
      // InSetText +Lib.s:9908: the rastport SoftStyle byte — it styles
      // the graphics Text instruction only; the console's underline is
      // the separate Under On/Off flag (Esc U)
      scr().textStyle = it.evalInt() & 0xff
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
      // InChangeMouse +Lib.s:12214: shape 0 and below error before MChange
      const n = it.evalInt()
      if (n <= 0) throw new AmosError('function call error')
      rt.changeMouse(n)
    },

    // ---- memory / banks ----
    'reserve as data': reserve('Datas', true),
    'reserve as work': reserve('Work', false),
    'reserve as chip data': reserve('Datas', true, true),
    'reserve as chip work': reserve('Work', false, true),
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
      // InErase +Lib.s:2210 has no error path — a missing bank is a no-op
      rt.memBanks.delete(n)
    },
    'erase all'() {
      rt.memBanks.clear()
      rt.spriteBank = null
      rt.iconBank = null
    },
    'erase temp'() {
      // Bnk.EffTemp +Lib.s:8059: erase every bank whose Data flag (bit 0)
      // is clear — i.e. Work banks; Data/Bob/Icon banks are kept
      for (const [n, b] of [...rt.memBanks]) {
        if ((b.flags & 1) === 0) rt.memBanks.delete(n)
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
      // InBankSwap +Lib.s:2235: swap the number fields; an absent bank
      // just renumbers the other one — never an error
      const ba = rt.memBanks.get(a)
      const bb = rt.memBanks.get(b)
      if (ba) rt.memBanks.delete(a)
      if (bb) rt.memBanks.delete(b)
      if (ba) rt.memBanks.set(b, { ...ba, number: b })
      if (bb) rt.memBanks.set(a, { ...bb, number: a })
    },
    'bank shrink'(it) {
      // Bnk.Schrink +Lib.s:8265: shrink only — a larger length errors
      const n = it.evalInt()
      it.expect('to')
      const len = it.evalInt()
      const bank = rt.memBanks.get(n)
      if (!bank) throw new AmosError('bank not reserved')
      if (len > bank.data.length || len < 0) throw new AmosError('function call error')
      bank.data = bank.data.subarray(0, len)
    },
    'list bank'(it) {
      // InListBank/Bnk.List +Lib.s:2194/8616: ascending bank number;
      // "NN - name8 S: $XXXXXXXX L: len" — numbers under 10 get a
      // leading space, bob/icon banks list their image COUNT as L:
      const lines: Array<[number, string, number]> = []
      if (rt.spriteBank) lines.push([1, 'Sprites', rt.spriteBank.images.length])
      if (rt.iconBank) lines.push([2, 'Icons', rt.iconBank.images.length])
      for (const [n, b] of rt.memBanks) lines.push([n, b.name, b.data.length])
      lines.sort((x, y2) => x[0] - y2[0])
      for (const [n, name, len] of lines) {
        const num = (n < 10 ? ' ' : '') + n
        const hex = rt.bankBase(n).toString(16).toUpperCase().padStart(8, '0')
        it.write(`${num} - ${name.padEnd(8).slice(0, 8)} S: $${hex} L: ${len}\n`)
      }
    },
    poke(it) {
      const addr = it.evalInt()
      it.expect(',')
      const v = it.evalInt()
      const m = rt.resolveWrite(addr)
      if (m) m.data[m.off] = v & 0xff
    },
    doke(it) {
      const addr = it.evalInt()
      it.expect(',')
      const v = it.evalInt()
      const m = rt.resolveWrite(addr)
      if (m && m.off + 1 < m.data.length) {
        m.data[m.off] = (v >> 8) & 0xff
        m.data[m.off + 1] = v & 0xff
      }
    },
    loke(it) {
      const addr = it.evalInt()
      it.expect(',')
      const v = it.evalInt()
      const m = rt.resolveWrite(addr)
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
      const m = rt.resolveWrite(addr)
      if (m) for (let i = 0; i < str2.length && m.off + i < m.data.length; i++) m.data[m.off + i] = str2.charCodeAt(i) & 0xff
    },
    fill(it) {
      // FillBis +Lib.s:2648: the long value written big-endian and repeated,
      // the trailing 1-3 bytes continuing the same rotation
      const start = it.evalInt()
      it.expect('to')
      const end = it.evalInt()
      it.expect(',')
      const v = it.evalInt()
      const m = rt.resolveWrite(start)
      if (!m) return
      const len = Math.min(end - start, m.data.length - m.off)
      for (let i = 0; i < len; i++) m.data[m.off + i] = (v >>> (24 - (i & 3) * 8)) & 0xff
    },
    copy(it) {
      // TransMem +Lib.s:2535: direction chosen by src/dst order so
      // overlapping moves within one bank stay correct
      const start = it.evalInt()
      it.expect(',')
      const end = it.evalInt()
      it.expect('to')
      const dest = it.evalInt()
      const src = rt.resolveAddr(start)
      const dst = rt.resolveWrite(dest)
      if (!src || !dst) return
      const len = Math.min(end - start, src.data.length - src.off, dst.data.length - dst.off)
      if (len <= 0) return
      if (src.data === dst.data) {
        // same bank: copyWithin handles overlap in both directions
        dst.data.copyWithin(dst.off, src.off, src.off + len)
      } else {
        dst.data.set(src.data.subarray(src.off, src.off + len), dst.off)
      }
    },
    bload(it) {
      // InBload +Lib.s:4307: destination through Bnk.OrAdr — a bank
      // number names a RESERVED bank (missing = bank not reserved); the
      // whole file loads to the address (bounded here by the region;
      // the real machine would overrun into raw memory)
      const path = it.evalStr()
      it.expect(',')
      const dest = it.evalInt()
      const bytes = rt.fs?.read(path)
      if (!bytes) throw new AmosError(`file not found: ${path}`)
      const m = rt.bankOrAddr(dest)
      if (m) m.data.set(bytes.subarray(0, m.data.length - m.off), m.off)
    },
    bsave(it) {
      // InBSave +Lib.s:4336: end-start must be positive (Rbls FonCall);
      // the start goes through Bnk.OrAdr
      const path = it.evalStr()
      it.expect(',')
      const start = it.evalInt()
      it.expect('to')
      const end = it.evalInt()
      const bankForm = start >= 0 && start < 0x10000
      const base = bankForm ? rt.bankBase(start) : start
      if (end - base <= 0) throw new AmosError('Illegal function call', 23)
      const m = rt.bankOrAddr(start)
      if (!m) throw new AmosError('address error')
      const len = Math.min(end - base, m.data.length - m.off)
      if (!rt.vfs?.writeFile(path, Uint8Array.from(m.data.subarray(m.off, m.off + len)))) {
        throw new AmosError('disc is write protected')
      }
    },
    ppload(it) {
      // Ppload "file"[,number] — InppLoad +CompExt.s:455. Loads a PowerPacked
      // "PPbk" bank; with no number the header's own bank number is used.
      const path = it.evalStr()
      const forced = it.accept(',') ? it.evalInt() : -1
      const bytes = rt.fs?.read(path)
      if (!bytes) throw new AmosError(`file not found: ${path}`)
      const bank = parsePpBank(Uint8Array.from(bytes))
      // bob/icon banks (flag bits 2/3) carry serialised objects — unsupported
      if (bank.flags & 0x0c) throw new AmosError('Not a powerpacked bank', 23)
      const num = forced >= 0 ? forced : bank.number
      rt.memBanks.set(num, {
        kind: 'memory',
        number: num,
        memType: bank.flags & 0x02 ? 1 : 0, // Bnk_BitChip
        name: bank.flags & 0x01 ? 'Datas' : 'Work',
        flags: bank.flags,
        data: bank.data,
      })
    },
    ppsave(it) {
      // Ppsave "file",number[,efficiency] — InppSave +CompExt.s:686
      const path = it.evalStr()
      it.expect(',')
      const num = it.evalInt()
      const efficiency = it.accept(',') ? it.evalInt() : 2
      if (efficiency < 0 || efficiency >= 5) throw new AmosError('Illegal function call', 23)
      const bank = rt.memBanks.get(num)
      if (!bank) throw new AmosError('bank not reserved', 36)
      const file = writePpBank({ number: num, flags: bank.flags | (bank.memType ? 0x02 : 0), data: bank.data })
      if (!rt.vfs?.writeFile(path, file)) throw new AmosError('disc is write protected')
    },
    'sam raw'(it) {
      // InSamRaw +Music.s:3157: freq<=500 then length<=256 error; plays
      // through GoSam, so Sam Loop On applies to raw plays too
      const mask = it.evalInt()
      it.expect(',')
      const addr = it.evalInt()
      it.expect(',')
      const len = it.evalInt()
      it.expect(',')
      const freq = it.evalInt()
      if (freq <= 500 || len <= 256) throw new AmosError('Illegal function call', 23)
      const m = rt.resolveAddr(addr)
      if (!m) return
      const pcm = new Int8Array(m.data.buffer, m.data.byteOffset + m.off, Math.min(len, m.data.length - m.off))
      rt.samPlay(mask & 15, pcm, freq)
    },
    'hrev block'(it) {
      // RevBloc +W.s:12620: FindBloc raises "Block not defined" on a missing
      // block, then Retourne mirrors the pixels along the chosen axis.
      const b = rt.blocks.get(it.evalInt())
      if (!b) throw new AmosError('block not defined')
      for (let y = 0; y < b.h; y++) b.pixels.subarray(y * b.w, (y + 1) * b.w).reverse()
    },
    'vrev block'(it) {
      const b = rt.blocks.get(it.evalInt())
      if (!b) throw new AmosError('block not defined')
      for (let y = 0; y < b.h >> 1; y++) {
        const a = b.pixels.slice(y * b.w, (y + 1) * b.w)
        b.pixels.copyWithin(y * b.w, (b.h - 1 - y) * b.w, (b.h - y) * b.w)
        b.pixels.set(a, (b.h - 1 - y) * b.w)
      }
    },

    // ---- files (Open In/Out, Print #, sequential channels) ----
    'open random'(it) {
      // InOpenRandom +Lib.s:5249 (RanApp $80): opens the existing file
      // or creates it; the channel type is random-access
      const n = it.evalInt()
      it.expect(',')
      const path = it.evalStr()
      const data = rt.fs?.read(path)
      rt.fileChans.set(n, { mode: 'random', path, data: data ? Uint8Array.from(data) : new Uint8Array(0), pos: 0, out: [] })
    },
    field(it) {
      // InField +ILib.s:4769: Field #c, len As var$,... — the channel
      // must be open; zero lengths error; the record size is the sum
      // and the file size is snapshotted here for the Get/Put checks
      it.accept('#')
      const n = it.evalInt()
      const c = rt.chan(n)
      const fields: NonNullable<typeof c.fields> = []
      let recSize = 0
      do {
        it.expect(',')
        const len = it.evalInt()
        it.expect('as')
        const tg = it.parseTarget()
        if (tg.type !== 2) throw new AmosError('Type mismatch')
        if (len <= 0) throw new AmosError('Illegal function call', 23)
        recSize += len
        fields.push({ len, get: () => str(tg.get()), set: (v: string) => tg.set(VS(v)) })
      } while (it.nm() === ',')
      c.fields = fields
      c.recSize = recSize
      c.fileSize = c.data.length
    },
    get(it) {
      // InGet +Lib.s:5291: Get #c,record — reads one record into the
      // Field variables; past the snapshot size is "end of file"
      const { c, off } = getPut(rt, it)
      if (off >= c.fileSize!) throw new AmosError('end of file')
      let pos = off
      for (const f of c.fields!) {
        if (pos + f.len > c.data.length) throw new AmosError('disc error')
        let s = ''
        for (let i = 0; i < f.len; i++) s += String.fromCharCode(c.data[pos + i]!)
        f.set(s)
        pos += f.len
      }
    },
    put(it) {
      // InPut +Lib.s:5324: writes each field (string truncated to the
      // field, short strings space-padded); writing may extend the file
      // by one record (offset > size is "end of file")
      const { c, off } = getPut(rt, it)
      if (off > c.fileSize!) throw new AmosError('end of file')
      const end = off + c.recSize!
      if (end > c.data.length) {
        const grown = new Uint8Array(end)
        grown.set(c.data)
        c.data = grown
      }
      let pos = off
      for (const f of c.fields!) {
        const s = f.get()
        for (let i = 0; i < f.len; i++) c.data[pos + i] = i < s.length ? s.charCodeAt(i) & 0xff : 32
        pos += f.len
      }
      if (c.data.length > c.fileSize!) c.fileSize = c.data.length
    },
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
    'dir/w'(it) {
      // InDirW (+Lib.s:5798 -> DirW2): the same listing compressed to two
      // columns — DirComp=1 with the name width halved to WiTx/2
      const path = it.atStmtEnd() ? '' : it.evalStr()
      const entries = rt.vfs?.listDir(path === '' ? rt.vfs.currentDir : path)
      if (!entries) throw new AmosError('directory not found')
      const width = Math.max(2, (rt.screen.curWin?.cols ?? 40) >> 1)
      let col = 0
      for (const e of entries) {
        const cell = ((e.isDir ? '*' : ' ') + e.name).slice(0, width - 1).padEnd(width)
        it.write(cell)
        if (++col === 2) {
          it.write('\n')
          col = 0
        }
      }
      if (col !== 0) it.write('\n')
    },
    parent(it) {
      // InParent +Lib.s:4878: strip the last path component of the
      // current directory (back to the ':' or previous '/')
      void it
      const vfs = rt.vfs
      if (!vfs) return
      const cur = vfs.currentDir
      const i = cur.lastIndexOf('/')
      const c = cur.indexOf(':')
      vfs.currentDir = i > c ? cur.slice(0, i) : cur.slice(0, c + 1)
    },
    bgrab(it) {
      // InBGrab +Lib.s:2303: pull bank n from the PREVIOUS program's
      // list. There is no previous program in the port (yet — Prun), so
      // the destination is erased and the grab fails: Bnk.Eff + BkNoRes
      const n = it.evalInt()
      if (n <= 0) throw new AmosError('function call error')
      rt.memBanks.delete(n)
      throw new AmosError('bank not reserved')
    },
    bsend(it) {
      // InBSend +Lib.s:2333: push bank n to the previous program — with
      // no previous program, Bnk.PrevProgram fails: function call error
      const n = it.evalInt()
      if (n <= 0) throw new AmosError('function call error')
      throw new AmosError('function call error')
    },
    'set dir'(it) {
      // InSetDir0/1 (+Lib.s:5515): Set Dir [width][,neg$] — width is
      // forced even (and.l #$FFFFFFFE), must be 2..104; the second arg is
      // the negative filename filter for listings
      if (!(it.atStmtEnd() || it.nm() === ',')) {
        const w = it.evalInt() & ~1
        if (w === 0 || w >= 106) throw new AmosError('function call error')
        rt.dirWidth = w
      }
      if (it.accept(',')) rt.dirNegFilter = it.evalStr()
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
    // ---- STOS-compatibility Anim / Move (InAnim2/InMoveX2 +Lib.s:11660) ----
    anim(it) {
      // Anim n,"(image,delay)...[L]" — an independent slot beside the
      // channel's AMAL program (ID channel*4+1, CreAMAL +W.s:7998)
      const n = it.evalInt()
      const limit = rt.synchroManual ? 64 : 16
      if (n >>> 0 >= limit) throw new AmosError('function call error')
      it.expect(',')
      const spec = parseStosAnim(it.evalStr())
      const slot = rt.stosSlot(n)
      slot.anim = { ...spec, idx: 0, left: 1, done: false, on: false, frozen: false }
    },
    'move x'(it) {
      const n = it.evalInt()
      const limit = rt.synchroManual ? 64 : 16
      if (n >>> 0 >= limit) throw new AmosError('function call error')
      it.expect(',')
      const spec = parseStosMove(it.evalStr())
      rt.stosSlot(n).moveX = { ...spec, gi: 0, speedLeft: 1, countLeft: spec.groups[0]![2] || 0x10000, started: false, done: false, on: false, frozen: false }
    },
    'move y'(it) {
      const n = it.evalInt()
      const limit = rt.synchroManual ? 64 : 16
      if (n >>> 0 >= limit) throw new AmosError('function call error')
      it.expect(',')
      const spec = parseStosMove(it.evalStr())
      rt.stosSlot(n).moveY = { ...spec, gi: 0, speedLeft: 1, countLeft: spec.groups[0]![2] || 0x10000, started: false, done: false, on: false, frozen: false }
    },
    'anim on'(it) {
      const n = it.atStmtEnd() ? null : it.evalInt()
      for (const [k, s] of rt.stosSlots) {
        if (n !== null && k !== n) continue
        if (s.anim) {
          s.anim.on = true
          s.anim.frozen = false
        }
      }
    },
    'anim off'(it) {
      const n = it.atStmtEnd() ? null : it.evalInt()
      for (const [k, s] of rt.stosSlots) {
        if (n !== null && k !== n) continue
        if (s.anim) s.anim.on = false
      }
    },
    'anim freeze'(it) {
      const n = it.atStmtEnd() ? null : it.evalInt()
      for (const [k, s] of rt.stosSlots) {
        if (n !== null && k !== n) continue
        if (s.anim) s.anim.frozen = true
      }
    },
    'move on'(it) {
      const n = it.atStmtEnd() ? null : it.evalInt()
      for (const [k, s] of rt.stosSlots) {
        if (n !== null && k !== n) continue
        for (const m of [s.moveX, s.moveY]) {
          if (m) {
            m.on = true
            m.frozen = false
          }
        }
      }
    },
    'move off'(it) {
      const n = it.atStmtEnd() ? null : it.evalInt()
      for (const [k, s] of rt.stosSlots) {
        if (n !== null && k !== n) continue
        for (const m of [s.moveX, s.moveY]) {
          if (m) m.on = false
        }
      }
    },
    'move freeze'(it) {
      const n = it.atStmtEnd() ? null : it.evalInt()
      for (const [k, s] of rt.stosSlots) {
        if (n !== null && k !== n) continue
        for (const m of [s.moveX, s.moveY]) {
          if (m) m.frozen = true
        }
      }
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
        // CAMG $800 = HAM: open through the 4096-colour path so the
        // compositor decodes the modify chains (InScreenOpen ScOo)
        const colours = img.mode & 0x800 ? 4096 : 1 << img.depth
        rt.openScreen(n, img.width, img.height, colours, (img.mode & 0x8000) | (img.mode & 4))
      }
      const s = scr()
      for (let i = 0; i < Math.min(32, img.palette.length); i++) s.palette[i] = img.palette[i]!
      if (img.width > 0) rt.blit(s, img, 0, 0, true)
    },
  }

  /** Reserve As ... n,length */
  function reserve(name: string, dataBank: boolean, chip = false): Instr {
    return (it) => {
      const n = it.evalInt()
      it.expect(',')
      rt.reserveBank(n, it.evalInt(), name, dataBank, chip)
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
      // Ritoune +Lib.s:12697: w=x2-x1, h=y2-y1 both must be positive and
      // within the screen
      if (x2 <= x1 || y2 <= y1 || x2 > s.width || y2 > s.height) throw new AmosError('function call error')
      bank.setImage(img, rt.grab(s, x1, y1, x2, y2))
    }
  }

  /** Del Bob/Sprite/Icon n[ To m] — splice+compact (Bnk.DelBob +Lib.s:8372) */
  function delObj(kind: 'sprite' | 'icon'): Instr {
    return (it) => {
      const n = it.evalInt()
      const m = it.accept('to') ? it.evalInt() : n
      const bank = kind === 'icon' ? rt.iconBank : rt.spriteBank
      if (!bank) throw new AmosError('bank not reserved')
      if (!bank.delete(n, m)) {
        if (kind === 'icon') rt.iconBank = null
        else rt.spriteBank = null
      }
    }
  }

  /** Ins Bob/Sprite/Icon n — single blank insert (Bnk.InsBob +Lib.s:8316) */
  function insObj(kind: 'sprite' | 'icon'): Instr {
    return (it) => {
      const n = it.evalInt()
      const bank = kind === 'icon' ? (rt.iconBank ??= new ObjectBank()) : rt.needSpriteBank()
      bank.insert(n)
    }
  }

  function polyish(close: boolean): Instr {
    return (it) => {
      const s = scr()
      const pts: Array<[number, number]> = []
      if (it.accept('to')) {
        pts.push([s.grX, s.grY])
      } else {
        const [x, y] = pair(it)
        pts.push([x, y])
        it.expect('to')
      }
      do {
        pts.push(pair(it))
      } while (it.accept('to'))
      if (close) {
        // Polygon is filled (InitArea/AreaEnd)
        s.fillPolygon(pts)
      } else {
        for (let i = 0; i + 1 < pts.length; i++) s.line(pts[i]![0], pts[i]![1], pts[i + 1]![0], pts[i + 1]![1])
      }
      const last = pts[pts.length - 1]!
      s.grX = last[0]
      s.grY = last[1]
    }
  }
}

/** raw-parsed runtime functions (their args use To syntax) */
export function makeRawFunctions(rt: Runtime): Record<string, (it: It) => import('../interp/values').Value> {
  return {
    array(it) {
      // FnArray +ILib.s:4103: the array's data address. Int/float arrays
      // get a live arena block (big-endian cells, FFP floats) that Peek/
      // Poke/Deek/Doke reach; the dialog engine resolves the same
      // address for its AR/AS zones. String arrays hold pointers on the
      // 68k — they keep an opaque handle (NOTES).
      it.expect('(')
      const t = it.tok()
      if (t?.kind !== 'var') throw new AmosError('array expected')
      const key = varKey(t.name, t.flags)
      const type = varType(t.flags)
      const arr = it.parseArrayRef()
      it.expect(')')
      if (type === 2) {
        for (const [h, known] of rt.dialogArrays) if (known === arr) return VI(h)
        const handle = 0x10000 + rt.dialogArrays.size
        rt.dialogArrays.set(handle, arr)
        return VI(handle)
      }
      const addr = rt.varptrArray(key, arr, type)
      rt.dialogArrays.set(addr, arr)
      return VI(addr)
    },
    'frame load'(it) {
      // =Frame Load(f To dest[,n]) — FnFormLoad +Lib.s:4412: n>0; a
      // dest under 1024 reserves a Work bank "Iff" sized by
      // IffFormSize; returns the number of frames loaded
      it.expect('(')
      const f = it.evalInt()
      it.expect('to')
      const dest = it.evalInt()
      const n = it.accept(',') ? it.evalInt() : 1
      it.expect(')')
      if (n <= 0 || dest <= 0) throw new AmosError('Illegal function call', 23)
      const c = rt.chan(f)
      if (c.mode !== 'in') throw new AmosError('file type mismatch')
      let view: { data: Uint8Array; off: number } | null
      if (dest < 1024) {
        rt.memBanks.delete(dest)
        const { bytes } = formSize(c.data, c.pos, n)
        rt.reserveBank(dest, bytes, 'Iff', false)
        view = { data: rt.memBanks.get(dest)!.data, off: 0 }
      } else {
        view = rt.resolveWrite(dest)
      }
      if (!view) return VI(0)
      const r = formLoad(c.data, c.pos, n, view.off === 0 ? view.data : view.data.subarray(view.off))
      c.pos = r.pos
      return VI(r.frames)
    },
    'frame length'(it) {
      // =Frame Length(f[,n]) — FnFormLength +Lib.s:4458: bytes for the
      // next n FORMs (+4 for AenD) without moving the position
      it.expect('(')
      const f = it.evalInt()
      const n = it.accept(',') ? it.evalInt() : 1
      it.expect(')')
      if (n < 0 || n >= 32768) throw new AmosError('Illegal function call', 23)
      const c = rt.chan(f)
      if (c.mode !== 'in') throw new AmosError('file type mismatch')
      return VI(formSize(c.data, c.pos, n).bytes)
    },
    'frame play'(it) {
      // =Frame Play(ad,n[,screen]) — FnFormPlay +Lib.s:4487: plays n
      // FORMs from the buffer; the screen argument creates the screen
      // at each BODY; returns the address after the played frames
      it.expect('(')
      const ad = it.evalInt()
      it.expect(',')
      const n = it.evalInt()
      const param = it.accept(',') ? it.evalInt() : null
      it.expect(')')
      return VI(framePlaySkip(rt, ad, n, param, false))
    },
    'frame skip'(it) {
      // =Frame Skip(ad[,n]) — FnFormSkip +Lib.s:4513: bit 30 set, no
      // drawing; returns the advanced address
      it.expect('(')
      const ad = it.evalInt()
      const n = it.accept(',') ? it.evalInt() : 1
      it.expect(')')
      return VI(framePlaySkip(rt, ad, n, null, true))
    },
    varptr(it) {
      // FnVarPtr +ILib.s:4087: numbers -> the address of the 4-byte cell
      // (arena slots that sync/flush through Peek/Poke, floats in FFP);
      // strings -> the character data, length word at -2, snapshotted
      // like the 68k's moving string heap
      it.expect('(')
      const tg = it.parseTarget()
      it.expect(')')
      if (tg.type === 2) {
        return VI(rt.varptrString(() => str(tg.get()), (v) => tg.set(VS(v))))
      }
      const type = tg.type
      return VI(rt.varptrScalar(tg.key ?? 'anon', type, () => num(tg.get()), (v) => tg.set(type === 1 ? VF(v) : VI(v))))
    },
    hunt(it) {
      // FnHunt +Lib.s:2672: the start goes through Bnk.OrAdr (a bank
      // number names its bank), the end address is raw; a match may
      // START before the end and extend past it (only the candidate
      // start is compared against the end)
      it.expect('(')
      const start = it.evalInt()
      it.expect('to')
      const finish = it.evalInt()
      it.expect(',')
      const needle = it.evalStr()
      it.expect(')')
      const bankForm = start >= 0 && start < 0x10000
      const base = bankForm ? rt.bankBase(start) : start
      const m = rt.bankOrAddr(start)
      if (!m || needle === '') return VI(0)
      const span = Math.min(finish - base, m.data.length - m.off)
      outer: for (let i = 0; i < span; i++) {
        for (let k = 0; k < needle.length; k++) {
          if (m.data[m.off + i + k] !== (needle.charCodeAt(k) & 0xff)) continue outer
        }
        return VI(base + i)
      }
      return VI(0)
    },
  }
}

export function makeFunctions(rt: Runtime): Record<string, Func> {
  const scr = (): Screen => rt.screen
  return {
    point(_, a) {
      // RPoint +Lib.s:9586 calls GrXY, so =Point(x,y) moves the graphics
      // cursor to x,y as a side effect
      const [x, y] = [a[0], a[1]]
      if (x === undefined || y === undefined) throw new AmosError('wrong number of arguments')
      const s = scr()
      const c = s.point(int(x), int(y))
      s.grX = int(x)
      s.grY = int(y)
      return VI(c)
    },
    screen(_, a) {
      void a
      return VI(rt.currentIndex)
    },
    'screen width'(_, a) {
      // FnScreenWidth0/1 +Lib.s:8778: EcTx bitmap width; an explicit
      // unopened screen number is an error, not a fallback
      return VI(screenArg(rt, a).width)
    },
    'screen height'(_, a) {
      return VI(screenArg(rt, a).height)
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
      // FnScreenBase +Lib.s:8798: ScOnAd — the current screen's control
      // block (the Ec structure), mapped read-only so Deek/Leek walks work
      return VI(rt.screenCtrlAddr(rt.currentIndex) | 0)
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
    'text styles'() {
      // FnTextStyle +Lib.s:9898: the rastport SoftStyle byte
      return VI(scr().textStyle)
    },
    'frame param'(_, a) {
      // FnFormParam +Lib.s:4616: the last DLTA's ANHD relative time
      void a
      return VI(rt.iffReturn)
    },
    'sprite base'(_, a) {
      return VI(objBase(rt, 'sprites', int(a[0]!)))
    },
    'icon base'(_, a) {
      return VI(objBase(rt, 'icons', int(a[0]!)))
    },
    'amos here'(_, a) {
      // FnAmosHere = AMOS_WB(-1): is the AMOS display in front? Always
      // true on a single-display host
      void a
      return VI(-1)
    },
    // =Prg First$ and =Dev First$ are the SAME routine on the 68k
    // (FnPrgFirst/FnDevFirst +Lib.s:5539 both go through DevAcc/FillDev):
    // they enumerate the mounted devices and assigns
    'dev first$'(_, a) {
      return VS(devFirst(rt, a.length > 0 ? str(a[a.length - 1]!) : '*'))
    },
    'dev next$'(_, a) {
      void a
      return VS(devNext(rt))
    },
    'prg first$'(_, a) {
      return VS(devFirst(rt, a.length > 0 ? str(a[a.length - 1]!) : '*'))
    },
    'prg next$'(_, a) {
      void a
      return VS(devNext(rt))
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
      // FnZoneD +Lib.s:14167: Zone$(text$,n) wraps text as a printable
      // text-zone — ESC "Z" <n> text ESC "Z" <n> (n is the last arg, d3);
      // n in 1..206 (sibling of Border$)
      const text = str(a[0]!)
      const n = int(a[1]!)
      if (n < 1 || n >= 207) throw new AmosError('function call error')
      const tag = '\x1bZ' + String.fromCharCode(48 + n)
      return VS(tag + text + tag)
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
      return VI(rt.spriteColCheck(int(a[0]!), a.length > 1 ? int(a[1]!) : 0, a.length > 2 ? int(a[2]!) : 63))
    },
    'bobsprite col'(_, a) {
      // FnBobSpriteCol1/3 +Lib.s:12367: bob n against hardware sprites
      return VI(rt.bobSpriteColCheck(int(a[0]!), a.length > 1 ? int(a[1]!) : 0, a.length > 2 ? int(a[2]!) : 63))
    },
    'spritebob col'(_, a) {
      // FnSpriteBobCol1/3 +Lib.s:12419: sprite n against bobs
      return VI(rt.spriteBobColCheck(int(a[0]!), a.length > 1 ? int(a[1]!) : 0, a.length > 2 ? int(a[2]!) : 10000))
    },
    col(_, a) {
      // =Col(n): >=0 membership; <0 = the first colliding object number
      return VI(rt.colGet(int(a[0]!)))
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
      // FnMouseZone +Lib.s:11077 -> SyZoHd +W.s:11150: hard coords map
      // into the current screen (display position, resolution doubling,
      // screen offset); outside the screen the answer is 0
      void a
      const s = scr()
      const x = (it.inp.mouseX - s.displayX) * (s.hires ? 2 : 1) + s.offsetX
      const y = it.inp.mouseY - s.displayY + s.offsetY
      if (x < 0 || y < 0 || x >= s.width || y >= s.height) return VI(0)
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
      // FnKeyShift +Lib.s:13660: the qualifier byte — 0 LShift, 1 RShift,
      // 2 CapsLock, 3 Ctrl, 4 LAlt, 5 RAlt, 6 LAmiga, 7 RAmiga
      void a
      let m = 0
      if (it.inp.keys.has(0x60)) m |= 1
      if (it.inp.keys.has(0x61)) m |= 2
      if (it.inp.keys.has(0x62)) m |= 4
      if (it.inp.keys.has(0x63)) m |= 8
      if (it.inp.keys.has(0x64)) m |= 16
      if (it.inp.keys.has(0x65)) m |= 32
      if (it.inp.keys.has(0x66)) m |= 64
      if (it.inp.keys.has(0x67)) m |= 128
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
      // FnVuMeter +Music.s:3893: voice 0-3 else illegal function call
      const v = int(a[0]!)
      if (v < 0 || v >= 4) throw new AmosError('Illegal function call', 23)
      return VI(rt.vumeter(v))
    },
    mubase() {
      // FnMusicBase +Music.s:3907: the extension data zone address; the
      // vumeter bytes at +0..3 are mapped into the fake address space
      return VI(Runtime.MUBASE_ADDR)
    },
    'sam swapped'(_, a) {
      // FnSamSwapped +Music.s:4055: voice 0-3 else illegal function call;
      // 1 = voice off, 0 = swap pending, -1 = playing / swap consumed
      const v = int(a[0]!)
      if (v < 0 || v > 3) throw new AmosError('Illegal function call', 23)
      return VI(rt.music.samState[v]!)
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
    'disc info$'(_, a) {
      // FnDiscInfo +Lib.s:4995: "VOLUME:" (from the volume node of the
      // locked path) + a 10-char field with the free byte count
      // left-aligned (LongToDec into ten spaces). Free space matches
      // =Dfree — the browser store has no real quota (see NOTES).
      const path = a.length > 0 ? str(a[0]!) : ''
      const vfs = rt.vfs
      if (!vfs) throw new AmosError('device not available')
      const r = vfs.resolve(path === '' ? vfs.currentDir : path)
      if (!r || vfs.exists(path === '' ? vfs.currentDir : path) === null) {
        throw new AmosError('device not available')
      }
      const volName = r.canonical.split(':')[0]!
      return VS(`${volName}:` + String(0x7fffffff).padEnd(10))
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
      // positive joker + Set Dir's negative filter apply to FILES only —
      // directories always list (FillNxt +Lib.s:6213: tst.w 4(a2) bpl)
      const neg = rt.dirNegFilter === '' ? null : amigaPattern(rt.dirNegFilter)
      const kept = entries.filter((e) => e.isDir || (rx.test(e.name) && !(neg && neg.test(e.name))))
      kept.sort((a2, b) => {
        const ka = fillSortKey((a2.isDir ? '*' : ' ') + a2.name)
        const kb = fillSortKey((b.isDir ? '*' : ' ') + b.name)
        return ka < kb ? -1 : 1
      })
      rt.dirIter = { entries: kept, idx: 0 }
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
      // =Choice: self-clearing latch (-1/0); =Choice(n): level n's number
      const m = rt.menu
      if (a.length === 0) {
        const v = m.choice
        m.choice = 0
        return VI(v)
      }
      const n = int(a[0]!)
      return VI(m.choix[n - 1] ?? 0)
    },
    'x menu'(_, a) {
      const node = rt.menu.find(a.map((v) => int(v)))
      return VI(node ? node.x : 0)
    },
    'y menu'(_, a) {
      const node = rt.menu.find(a.map((v) => int(v)))
      return VI(node ? node.y : 0)
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
    movon(_, a) {
      // =Movon(n) (FnMovon +Lib.s:11945): -1 while a Move X/Y program on
      // channel n is still running
      const n = int(a[0]!)
      if (n < 0) throw new AmosError('function call error')
      const s = rt.stosSlots.get(n)
      const live = (m: { on: boolean; done: boolean } | undefined): boolean => !!m && m.on && !m.done
      return VI(s && (live(s.moveX) || live(s.moveY)) ? -1 : 0)
    },
    'cop logic'(_, a) {
      // =Cop Logic (FnCopLogic +Lib.s:9527 → TCopBs): the address of the
      // logical copper list — real mapped memory, Leek/Loke reach it
      void a
      return VI(rt.copLogicAddr() | 0)
    },
    rain(_, a) {
      // =Rain(n,line) (FnRain +Lib.s:9447 → TRVar +W.s:3966): bounds
      // errors report as OUT OF MEMORY via EcWiErr, like Rainbow
      const n = int(a[0]!)
      const line = int(a[1]!)
      const rb = rt.rainbows.get(n)
      if (n >>> 0 >= 4 || !rb || rb.table.length === 0 || line < 0 || line >= rb.table.length)
        throw new AmosError('out of memory')
      return VI(rb.table[line]!)
    },
    ntsc(_, a) {
      void a
      return VI(0) // FnNTSC: the emulated machine is PAL
    },
    'display height'(_, a) {
      // MaxRaw +Lib.s:8835 / TMaxRaw +W.s:2607: the current screen's bottom
      // raster line — laced screens reach ~2x
      void a
      const s = rt.screen
      return VI(s.laced ? s.height : Math.min(283, Math.max(s.height, 256)))
    },
    'screen mode'(_, a) {
      // FnScreenMode +Lib.s:8818: EcCon0 & $8004
      void a
      const s = rt.screen
      return VI((s.hires ? 0x8000 : 0) | (s.laced ? 4 : 0))
    },
    logbase(_, a) {
      // FnLogBase +Lib.s:8851: EcLogic[plane]; the plane arg defaults to 0
      return VI(planeBase(rt, a.length ? int(a[0]!) : 0, 0))
    },
    phybase(_, a) {
      // FnPhyBase +Lib.s:8864: EcPhysic[plane]; the plane arg defaults to 0
      return VI(planeBase(rt, a.length ? int(a[0]!) : 0, 1))
    },
    'font$'(_, a) {
      // FnFont +Lib.s:9786: requires Get Fonts first ("fonts not
      // examined"); negative errors; past the list returns "". The
      // string is exactly 38 chars: name to 30, height decimal at 30,
      // "Rom "/"Disc" at 34.
      const n = int(a[0]!)
      if (n < 0) throw new AmosError('Illegal function call', 23)
      if (!rt.fontsListed) throw new AmosError('fonts not examined')
      const f = examinedFonts(rt)[n - 1]
      if (!f) return VS('')
      const out = (f.name + ' ').padEnd(30).slice(0, 30) + String(f.height).padEnd(4).slice(0, 4) + (f.type === 'Rom' ? 'Rom ' : 'Disc')
      return VS(out)
    },
    'resource$'(_, a) {
      // FnResource +ILib.s:6699: n>0 = message n of the puzzle bank; 0 =
      // the system path; -1..-1000 = the interpreter-config messages
      // (Sys_Messages); deeper negatives reach the editor's own message
      // tables, which the port doesn't carry — empty string
      const n = int(a[0]!)
      if (n > 0) {
        const msgs = rt.resource().messages
        return VS(msgs?.[n - 1] ?? '')
      }
      if (n === 0) return VS('AMOSPro:')
      if (n >= -1000) return VS(SYS_MESSAGES[-n] ?? '')
      return VS('')
    },

    at(_, a) {
      // FnAt +Lib.s:14046: Esc X / Esc Y escapes, one per present
      // coordinate; values above 207 (255-48) are a function call error
      let out = ''
      const x = int(a[0]!)
      const y = int(a[1]!)
      if (x > 207 || y > 207) throw new AmosError('Illegal function call', 23)
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
    rev(_, a) {
      // FnRev +Lib.s:12744: both flip bits at once
      return VI(int(a[0]!) | 0xc000)
    },
    'scan$'(_, a) {
      // FnScan1/2 +Lib.s:13799: a 4-byte Put Key scancode injection
      // string — chr$(1), scancode, shift, chr$(0); both bytes < 256
      const scan = int(a[0]!)
      const shift = a.length > 1 ? int(a[1]!) : 0
      if (scan >>> 0 >= 256 || shift >>> 0 >= 256) throw new AmosError('function call error')
      return VS(String.fromCharCode(1, scan, shift, 0))
    },
    'bstart'(_, a) {
      // FnBStart +Lib.s:2271: bank address in the PREVIOUS program's list
      // (the editor/accessory exchange) — no parent program here, so the
      // Bnk.PrevProgram failure path: bank not reserved
      void a
      throw new AmosError('bank not reserved')
    },
    'blength'(_, a) {
      // FnBLength +Lib.s:2284: 0 when there is no previous program's bank
      void a
      return VI(0)
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
    squash(_, a) {
      // =Squash(address,length,fast,speed,colour) — Squash +CompExt.s:969.
      // Compresses in place and returns the compressed length, or -1 when the
      // result would not beat the original ("Squashed >= Normal").
      const address = int(a[0]!)
      const length = int(a[1]!)
      const speed = a.length >= 4 ? int(a[3]!) : 4095
      const colour = a.length >= 5 ? int(a[4]!) : 0
      if (length <= 0 || colour < 0 || colour >= 32) throw new AmosError('Illegal function call', 23)
      if (a.length >= 4 && (speed < 256 || speed >= 4096)) throw new AmosError('Illegal function call', 23)
      const m = rt.resolveAddr(address)
      if (!m) throw new AmosError('Address error', 25)
      const len = Math.min(length, m.data.length - m.off)
      const packed = squashBytes(m.data.slice(m.off, m.off + len), Math.min(speed, 4096))
      if (!packed) return VI(-1)
      m.data.set(packed, m.off)
      return VI(packed.length)
    },
    unsquash(_, a) {
      // =Unsquash(address,length) — UnSquash +CompExt.s:1468. Decompresses in
      // place; returns the expanded length, -1 on corrupt data (bad checksum)
      // or -2 if it would write past the end of the memory block.
      const address = int(a[0]!)
      const length = int(a[1]!)
      if (length <= 0) throw new AmosError('Illegal function call', 23)
      const m = rt.resolveAddr(address)
      if (!m) throw new AmosError('Address error', 25)
      const comp = m.data.slice(m.off, m.off + Math.min(length, m.data.length - m.off))
      let out: Uint8Array
      try {
        out = unsquashBytes(comp)
      } catch {
        return VI(-1)
      }
      if (m.off + out.length > m.data.length) return VI(-2)
      m.data.set(out, m.off)
      return VI(out.length)
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
      return VI(-0x80000000) // GetSIn +W.s:10944 returns EntNul when over no screen
    },
    scanshift(it, a) {
      // FnScanshift +Lib.s:13640: the shift byte captured with the last
      // Inkey$, read AND cleared (like Scancode)
      void a
      const v = it.inp.lastShift
      it.inp.lastShift = 0
      return VI(v)
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
      // FnBorderD +Lib.s:14153: style 1-15 (0 and >=16 error); the text
      // is wrapped in Esc E 0 (store position) ... Esc E n (draw box)
      const n = int(a[1]!)
      if (n <= 0 || n >= 16) throw new AmosError('Illegal function call', 23)
      return VS('\x1bE0' + str(a[0]!) + '\x1bE' + String.fromCharCode(48 + n))
    },
  }

  function nextDirEntry(): string {
    const it2 = rt.dirIter
    if (!it2 || it2.idx >= it2.entries.length) return ''
    const e = it2.entries[it2.idx++]!
    return e.isDir ? fillEntry(rt, '*', e.name, null) : fillEntry(rt, ' ', e.name, e.size)
  }
}
