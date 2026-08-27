/**
 * The AMOS Professional menu engine, ported from the Mn* routines in
 * +Lib.s (object tokenizer 17464-17678, geometry 16341-16572, rendering
 * 16581-16923, interaction MnGere 15811-16136) and the definition
 * instructions in +ILib.s (InMenu 6856, InMenuKey 6760, MnDim 6996).
 *
 * A menu is a tree of nodes (title → items → sub-items, up to 8 open
 * levels). Each node carries up to four COMPILED label objects — normal,
 * highlighted, inactive, background — written in a mini-language of
 * `(XX p1,p2)` commands embedded in the label string. Layout is driven by
 * per-level flag defaults: level 1 is a full-width horizontal bar
 * (MnTotal), deeper levels are vertical columns (MnBar) opening to the
 * right.
 */

// MnFlag bits (+Equ.s:845-852)
export const MF_FLAT = 1 << 0
export const MF_FIXED = 1 << 1
export const MF_SEP = 1 << 2
export const MF_BAR = 1 << 3
export const MF_OFF = 1 << 4
export const MF_TOTAL = 1 << 5
export const MF_TBOUGE = 1 << 6
export const MF_BOUGE = 1 << 7

/** compiled label object ops (MnOToken +Lib.s:17634-17649) */
export type MenuOp =
  | { op: 'text'; s: string }
  | { op: 'bar'; x: number; y: number } // BA
  | { op: 'line'; x: number; y: number } // LI
  | { op: 'ellipse'; rx: number; ry: number } // EL
  | { op: 'locate'; x: number; y: number } // LO
  | { op: 'pattern'; n: number } // PA
  | { op: 'ink'; sel: number; c: number } // IN (selector first!)
  | { op: 'bob'; n: number } // BO
  | { op: 'icon'; n: number } // IC
  | { op: 'outline'; n: number } // OU
  | { op: 'setline'; n: number } // SL
  | { op: 'setfont'; n: number } // SF
  | { op: 'proc'; name: string } // PR
  | { op: 'reserve'; n: number } // RE
  | { op: 'style'; n: number } // SS

export interface MenuKey {
  kind: 0 | 1 | -1 // none / ASCII / scancode+shift
  asc: number
  scan: number
  shift: number
}

export interface MenuNode {
  nb: number
  flags: number
  /** Menu Called: redrawn (and PR re-run) every frame while open */
  called: boolean
  children: MenuNode[]
  /** position relative to the parent (MnX/MnY); MnFixed = user-set */
  x: number
  y: number
  /** measured cell size (MnTx/MnTy) */
  tx: number
  ty: number
  /** branch bounds (MnMX/MnMY) */
  mx: number
  my: number
  /** absolute screen coords (MnXX/MnYY, set by the maxi pass) */
  xx: number
  yy: number
  key: MenuKey
  ob1: MenuOp[] | null
  ob2: MenuOp[] | null
  ob3: MenuOp[] | null
  obF: MenuOp[] | null
  /** ink sets: [A, B, C] normal and highlighted (defaults = inverse video) */
  inks1: [number, number, number]
  inks2: [number, number, number]
}

export function newMenuNode(nb: number, flags: number): MenuNode {
  return {
    nb,
    flags,
    called: false,
    children: [],
    x: 0,
    y: 0,
    tx: 0,
    ty: 0,
    mx: 0,
    my: 0,
    xx: 0,
    yy: 0,
    key: { kind: 0, asc: 0, scan: 0, shift: 0 },
    ob1: null,
    ob2: null,
    ob3: null,
    obF: null,
    inks1: [1, 2, 1],
    inks2: [2, 1, 1],
  }
}

// ---- the label object compiler (MnObjet +Lib.s:17435) ----

const MENU_CMDS: Record<string, { params: number }> = {
  BA: { params: 2 },
  LI: { params: 2 },
  EL: { params: 2 },
  PA: { params: 1 },
  IN: { params: 2 },
  BO: { params: 1 },
  IC: { params: 1 },
  LO: { params: 2 },
  OU: { params: 1 },
  SL: { params: 1 },
  SF: { params: 1 },
  PR: { params: -1 }, // procedure name
  RE: { params: 1 },
  SS: { params: 1 },
}

/**
 * Compile a label string: plain text runs become text ops; `(XX p1,p2)`
 * groups become commands (first two letters significant, params literal
 * decimal, `:` separates commands inside one group, ESC skips two bytes).
 */
export function compileMenuObject(src: string): MenuOp[] {
  const ops: MenuOp[] = []
  let text = ''
  let i = 0
  const flushText = (): void => {
    if (text !== '') {
      ops.push({ op: 'text', s: text })
      text = ''
    }
  }
  while (i < src.length) {
    const c = src[i]!
    if (c === '\x1b') {
      // MnOCh1: ESC passes the next two bytes through as text
      text += src.slice(i + 1, i + 3)
      i += 3
      continue
    }
    if (c !== '(') {
      text += c
      i++
      continue
    }
    flushText()
    i++ // past '('
    for (;;) {
      // skip blanks
      while (i < src.length && (src[i] === ' ' || src[i] === ':')) i++
      const name = src.slice(i, i + 2).toUpperCase()
      const def = MENU_CMDS[name]
      if (!def) {
        // unknown: skip to ')' (the 68k tokenizer errors; be tolerant)
        while (i < src.length && src[i] !== ')') i++
        break
      }
      i += 2
      // skip the rest of the word (e.g. "BAr", "INk")
      while (i < src.length && /[A-Za-z]/.test(src[i]!)) i++
      while (i < src.length && src[i] === ' ') i++
      if (def.params === -1) {
        // procedure name: up to ':' or ')'
        let name2 = ''
        while (i < src.length && src[i] !== ')' && src[i] !== ':') name2 += src[i++]!
        ops.push({ op: 'proc', name: name2.trim().toUpperCase() })
      } else {
        const params: number[] = []
        for (let p = 0; p < def.params; p++) {
          while (i < src.length && (src[i] === ' ' || src[i] === ',')) i++
          let neg = false
          if (src[i] === '-') {
            neg = true
            i++
          }
          let v = 0
          while (i < src.length && src[i]! >= '0' && src[i]! <= '9') v = v * 10 + (src.charCodeAt(i++) - 48)
          params.push(neg ? -v : v)
        }
        switch (name) {
          case 'BA':
            ops.push({ op: 'bar', x: params[0]!, y: params[1]! })
            break
          case 'LI':
            ops.push({ op: 'line', x: params[0]!, y: params[1]! })
            break
          case 'EL':
            ops.push({ op: 'ellipse', rx: params[0]!, ry: params[1]! })
            break
          case 'LO':
            ops.push({ op: 'locate', x: params[0]!, y: params[1]! })
            break
          case 'PA':
            ops.push({ op: 'pattern', n: params[0]! })
            break
          case 'IN':
            ops.push({ op: 'ink', sel: params[0]!, c: params[1]! })
            break
          case 'BO':
            ops.push({ op: 'bob', n: params[0]! })
            break
          case 'IC':
            ops.push({ op: 'icon', n: params[0]! })
            break
          case 'OU':
            ops.push({ op: 'outline', n: params[0]! })
            break
          case 'SL':
            ops.push({ op: 'setline', n: params[0]! })
            break
          case 'SF':
            ops.push({ op: 'setfont', n: params[0]! })
            break
          case 'RE':
            ops.push({ op: 'reserve', n: params[0]! })
            break
          case 'SS':
            ops.push({ op: 'style', n: params[0]! })
            break
        }
      }
      while (i < src.length && src[i] === ' ') i++
      if (src[i] === ':') {
        i++
        continue
      }
      break
    }
    while (i < src.length && src[i] !== ')') i++
    i++ // past ')'
  }
  flushText()
  return ops
}

// ---- the tree ----

export class MenuTree {
  roots: MenuNode[] = []
  baseX = 0
  baseY = 0
  /** per-level default flags (MnDFlags via MenuReset +Lib.s:17279) */
  dFlags: number[] = []
  change = true
  mouse = false
  /** the screen that owns the menu (bound at the first Menu$=) */
  screenNb = -1
  on = false
  /** =Choice latch (-1 selection made, 0 not) and per-level numbers */
  choice = 0
  choix: number[] = [0, 0, 0, 0, 0, 0, 0, 0]

  constructor() {
    this.reset()
  }

  /** MenuReset: level 1 = full-width movable bar, deeper = columns */
  reset(): void {
    this.roots = []
    // MenuReset (+Lib.s:17282): level 1 is MnTotal|MnTBouge, and the loop
    // for "Autres dimensions" sets MnBar AND MnTBouge on the other seven —
    // the port had been leaving MnTBouge off every level but the first
    this.dFlags = [
      MF_TOTAL | MF_TBOUGE,
      ...Array<number>(7).fill(MF_BAR | MF_TBOUGE),
    ]
    this.change = true
    this.choice = 0
    this.choix.fill(0)
  }

  /** MnFind: walk the index path (1-based numbers per level) */
  find(path: number[]): MenuNode | null {
    let list = this.roots
    let node: MenuNode | null = null
    for (const nb of path) {
      node = list.find((n) => n.nb === nb) ?? null
      if (!node) return null
      list = node.children
    }
    return node
  }

  /** MnIns: find-or-create the node at the path with level defaults */
  insert(path: number[]): MenuNode {
    let list = this.roots
    let node: MenuNode | null = null
    for (let level = 0; level < path.length; level++) {
      const nb = path[level]!
      node = list.find((n) => n.nb === nb) ?? null
      if (!node) {
        node = newMenuNode(nb, this.dFlags[level] ?? MF_BAR)
        list.push(node)
        list.sort((a, b) => a.nb - b.nb)
      }
      list = node.children
    }
    this.change = true
    return node!
  }

  /** MnDel/MnEff: delete the subtree at the path (empty path = wipe all) */
  delete(path: number[]): void {
    if (path.length === 0) {
      this.reset()
      return
    }
    const parentPath = path.slice(0, -1)
    const list = parentPath.length === 0 ? this.roots : (this.find(parentPath)?.children ?? null)
    if (!list) return
    const i = list.findIndex((n) => n.nb === path[path.length - 1])
    if (i >= 0) list.splice(i, 1)
    this.change = true
  }

  /**
   * Apply a flag to one level's DEFAULT, and to nothing else.
   *
   * MnDim's bare-number form (+ILib.s:6974) is `tst.l d3 / beq FonCall /
   * cmp.l #MnNDim,d3 / bhi FonCall / lea MnDFlags(a5),a0 / lea -1(a0,d3.w)`,
   * and every keyword that reaches it then does a single bset or bclr on
   * that one byte. `MnNDim equ 8` (+Equ.s:1400).
   *
   * MnDFlags is only ever read in two places: MnIF (+Lib.s:17260) ORs it
   * into a node it has just created, and MenuReset (+Lib.s:17282) writes the
   * defaults. Nothing consults it when drawing. So the level flags are a
   * template for menus made from now on, and the port's walk over existing
   * nodes was rewriting flags AMOS leaves alone.
   */
  setLevelFlag(level: number, set: number, clear: number): void {
    if (level <= 0 || level > 8) funcCall()
    this.dFlags[level - 1] = (this.dFlags[level - 1]! | set) & ~clear
    this.change = true
  }
}

// ---- rendering (MnDraw/MnODraw +Lib.s:16552-16894) ----

import { funcCall } from '../interp/values'
import type { Screen } from './screen'
import { builtinPattern } from './screen'

export interface MenuImage {
  width: number
  height: number
  hotX?: number
  hotY?: number
  pixels: Uint8Array
}

export interface MenuHost {
  bobImage(n: number): MenuImage | null
  iconImage(n: number): MenuImage | null
  /** PR command — invoked when the item draws (Menu Called re-invokes) */
  callProc(name: string): void
}

interface DrawState {
  x: number
  y: number
  inks: [number, number, number]
  outline: boolean
  pattern: Uint16Array | null
  linePattern: number
  style: number
}

/**
 * Run a compiled object at (ox,oy) on the screen (MnODraw). In measure
 * mode nothing is drawn; the returned extent becomes the cell size.
 */
export function runMenuObject(
  ops: MenuOp[],
  s: Screen | null,
  host: MenuHost | null,
  ox: number,
  oy: number,
  inks: [number, number, number],
): { w: number; h: number } {
  const st: DrawState = { x: 0, y: 0, inks: [...inks] as [number, number, number], outline: false, pattern: null, linePattern: 0xffff, style: 0 }
  let w = 0
  let h = 8 // an empty label still occupies a text row
  const extend = (x: number, y: number): void => {
    if (x > w) w = x
    if (y > h) h = y
  }
  const drawText = (text: string): void => {
    for (const ch of text) {
      if (ch === '\n') {
        st.x = 0
        st.y += 8
        continue
      }
      if (s) {
        s.drawChar(ox + st.x, oy + st.y, ch.charCodeAt(0), st.inks[0], st.inks[1], false)
        if (st.style & 1) for (let x = 0; x < 8; x++) s.plot(ox + st.x + x, oy + st.y + 7, st.inks[0])
      }
      st.x += 8
      extend(st.x, st.y + 8)
    }
  }
  const blit = (img: MenuImage | null): void => {
    if (!img) return
    if (s) {
      for (let y = 0; y < img.height; y++) {
        for (let x = 0; x < img.width; x++) {
          const c = img.pixels[y * img.width + x]!
          if (c !== 0) s.plot(ox + st.x + x, oy + st.y + y, c)
        }
      }
    }
    extend(st.x + img.width, st.y + img.height)
  }
  for (const op of ops) {
    switch (op.op) {
      case 'text':
        drawText(op.s)
        break
      case 'locate':
        st.x = op.x
        st.y = op.y
        extend(st.x, st.y)
        break
      case 'bar': {
        if (s) {
          // a menu draws with its own pens and leaves the screen's alone. The
          // RastPort enumerates its own fields, so this cannot miss one the
          // way a hand-written list did — these two sites used to save five
          // fields and one respectively
          const saved = s.rp.snapshot()
          s.ink = st.inks[0]
          s.gPaper = st.inks[1]
          s.gBorder = st.inks[2]
          s.pattern = st.pattern
          s.outline = st.outline
          s.bar(ox + st.x, oy + st.y, ox + op.x, oy + op.y)
          s.rp.restore(saved)
        }
        extend(op.x + 1, op.y + 1)
        break
      }
      case 'line':
        if (s) {
          const saved = s.rp.snapshot()
          s.linePattern = st.linePattern
          s.line(ox + st.x, oy + st.y, ox + op.x, oy + op.y, st.inks[0])
          s.rp.restore(saved)
        }
        st.x = op.x
        st.y = op.y
        extend(op.x + 1, op.y + 1)
        break
      case 'ellipse':
        if (s) s.ellipse(ox + st.x, oy + st.y, op.rx, op.ry, st.inks[0], false)
        extend(st.x + op.rx, st.y + op.ry)
        break
      case 'ink': {
        const sel = op.sel
        if (sel <= 1) st.inks[0] = op.c
        else if (sel === 2) st.inks[1] = op.c
        else st.inks[2] = op.c
        break
      }
      case 'pattern':
        st.pattern = builtinPattern(op.n)
        break
      case 'outline':
        st.outline = op.n !== 0
        break
      case 'setline':
        st.linePattern = op.n & 0xffff
        break
      case 'style':
        st.style = op.n
        break
      case 'setfont':
        break // single-face port
      case 'bob':
        blit(host?.bobImage(op.n) ?? null)
        break
      case 'icon':
        blit(host?.iconImage(op.n) ?? null)
        break
      case 'proc':
        if (s && host) host.callProc(op.name)
        break
      case 'reserve':
        break
    }
  }
  return { w, h }
}

// ---- geometry (MnCalc 16341 / MnMaxi 16510) ----

/** measure every node and lay out relative positions */
export function menuCalc(tree: MenuTree): void {
  const layout = (list: MenuNode[]): void => {
    let curX = 0
    let curY = 0
    for (const n of list) {
      const m = runMenuObject(n.ob1 ?? [], null, null, 0, 0, n.inks1)
      n.tx = m.w + 2
      n.ty = m.h + 1
      if (!(n.flags & MF_FIXED)) {
        n.x = curX
        n.y = curY
      }
      // sibling advance: MnBar = vertical column, else horizontal row
      if (n.flags & MF_BAR) curY = n.y + n.ty
      else curX = n.x + n.tx
      if (n.children.length > 0) layout(n.children)
    }
  }
  layout(tree.roots)
  tree.change = false
}

/** absolute coords + group bounds for one open level (MnMaxi) */
export function menuMaxi(list: MenuNode[], absX: number, absY: number, screenW: number): { x1: number; y1: number; x2: number; y2: number } {
  let x1 = Infinity
  let y1 = Infinity
  let x2 = -Infinity
  let y2 = -Infinity
  for (const n of list) {
    n.xx = absX + n.x + 2 // auto-border 2px inset
    n.yy = absY + n.y + 2
    x1 = Math.min(x1, n.xx - 2)
    y1 = Math.min(y1, n.yy - 2)
    x2 = Math.max(x2, n.xx + n.tx + 1)
    y2 = Math.max(y2, n.yy + n.ty + 1)
  }
  if (x1 > x2) return { x1: absX, y1: absY, x2: absX, y2: absY }
  if (list.some((n) => n.flags & MF_TOTAL)) {
    // Tline / title bar: stretch the box to the full screen width
    x1 = 0
    x2 = screenW - 1
  }
  return { x1, y1, x2, y2 }
}

export interface OpenLevel {
  list: MenuNode[]
  bounds: { x1: number; y1: number; x2: number; y2: number }
  saved: Uint8Array
  /** the branch origin, kept for redraws while dragging */
  ox: number
  oy: number
}

/** save the pixels under a rect (MnSave 17033) */
export function saveRect(s: Screen, r: { x1: number; y1: number; x2: number; y2: number }): Uint8Array {
  const w = r.x2 - r.x1 + 1
  const h = r.y2 - r.y1 + 1
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const sy = r.y1 + y
    if (sy < 0 || sy >= s.height) continue
    for (let x = 0; x < w; x++) {
      const sx = r.x1 + x
      if (sx >= 0 && sx < s.width) out[y * w + x] = s.pixels[sy * s.width + sx]!
    }
  }
  return out
}

export function restoreRect(s: Screen, r: { x1: number; y1: number; x2: number; y2: number }, saved: Uint8Array): void {
  const w = r.x2 - r.x1 + 1
  const h = r.y2 - r.y1 + 1
  for (let y = 0; y < h; y++) {
    const sy = r.y1 + y
    if (sy < 0 || sy >= s.height) continue
    for (let x = 0; x < w; x++) {
      const sx = r.x1 + x
      if (sx >= 0 && sx < s.width) s.putPixel(sx, sy, saved[y * w + x]!)
    }
  }
}

/** draw one cell: background object, then normal/highlight/inactive (MnDraw) */
export function drawMenuCell(n: MenuNode, s: Screen, host: MenuHost, highlighted: boolean): void {
  if (n.obF) runMenuObject(n.obF, s, host, n.xx, n.yy, [n.inks1[1], n.inks1[0], n.inks1[2]])
  const inactive = (n.flags & MF_OFF) !== 0
  if (inactive && n.ob3) {
    runMenuObject(n.ob3, s, host, n.xx, n.yy, n.inks1)
    return
  }
  if (highlighted && n.ob2) {
    runMenuObject(n.ob2, s, host, n.xx, n.yy, n.inks1)
    return
  }
  runMenuObject(n.ob1 ?? [], s, host, n.xx, n.yy, highlighted ? n.inks2 : n.inks1)
}

/**
 * Open one level: absolute coords, save the background, draw the group
 * box (fill = ink B, outline = ink C of the first node) and every cell
 * (MnBranch 16445). Returns the state needed to restore on close.
 */
export function drawMenuBranch(list: MenuNode[], s: Screen, host: MenuHost, absX: number, absY: number): OpenLevel {
  const bounds = menuMaxi(list, absX, absY, s.width)
  const saved = saveRect(s, bounds)
  const first = list[0]
  if (first && !first.obF) {
    const savedGfx = s.rp.snapshot()
    s.ink = first.inks1[1]
    s.gBorder = first.inks1[2] === first.inks1[1] ? first.inks1[0] : first.inks1[2]
    s.pattern = null
    s.outline = true
    s.bar(bounds.x1, bounds.y1, bounds.x2, bounds.y2)
    s.rp.restore(savedGfx)
  }
  for (const n of list) drawMenuCell(n, s, host, false)
  return { list, bounds, saved, ox: absX, oy: absY }
}

/** hit-test the open level's cells at screen coords */
export function menuZoneAt(level: OpenLevel, x: number, y: number): MenuNode | null {
  for (const n of level.list) {
    if (n.flags & MF_OFF) continue
    if (x >= n.xx && x < n.xx + n.tx && y >= n.yy && y < n.yy + n.ty) return n
  }
  return null
}

// ---- menu banks (Menu To Bank 15401 / Bank To Menu 15494) ----
//
// A "Menu    " bank is the node records (70 bytes each, MnLong) copied
// with Next/Lat/object pointers rewritten as bank-relative offsets, each
// node followed by its compiled objects. An object blob is an
// inclusive-length-prefixed word stream: text = word 4, length word,
// padded bytes; commands = word id (8 + 4*table index) + param words;
// terminated by a zero word. Verified byte-level against the tutorial's
// Data.Menu.

const CMD_IDS = ['BA', 'LI', 'EL', 'PA', 'IN', 'BO', 'IC', 'LO', 'OU', 'SL', 'SF', 'PR', 'RE', 'SS']
const CMD_PARAMS = [2, 2, 2, 1, 2, 1, 1, 2, 1, 1, 1, -1, 1, 1]

function encodeObject(ops: MenuOp[]): Uint8Array {
  const words: number[] = []
  const bytes: number[] = []
  const flush = (): void => {
    for (const w of words) {
      bytes.push((w >> 8) & 0xff, w & 0xff)
    }
    words.length = 0
  }
  const pushText = (s: string): void => {
    words.push(4, s.length)
    flush()
    for (const c of s) bytes.push(c.charCodeAt(0) & 0xff)
    if (s.length & 1) bytes.push(0)
  }
  for (const op of ops) {
    switch (op.op) {
      case 'text':
        pushText(op.s)
        break
      case 'proc':
        words.push(8 + 4 * CMD_IDS.indexOf('PR'))
        pushText(op.name)
        break
      default: {
        const name =
          op.op === 'bar' ? 'BA'
          : op.op === 'line' ? 'LI'
          : op.op === 'ellipse' ? 'EL'
          : op.op === 'pattern' ? 'PA'
          : op.op === 'ink' ? 'IN'
          : op.op === 'bob' ? 'BO'
          : op.op === 'icon' ? 'IC'
          : op.op === 'locate' ? 'LO'
          : op.op === 'outline' ? 'OU'
          : op.op === 'setline' ? 'SL'
          : op.op === 'setfont' ? 'SF'
          : op.op === 'reserve' ? 'RE'
          : 'SS'
        words.push(8 + 4 * CMD_IDS.indexOf(name))
        if (op.op === 'bar' || op.op === 'line' || op.op === 'locate') words.push(op.x & 0xffff, op.y & 0xffff)
        else if (op.op === 'ellipse') words.push(op.rx & 0xffff, op.ry & 0xffff)
        else if (op.op === 'ink') words.push(op.sel & 0xffff, op.c & 0xffff)
        else words.push((op as { n: number }).n & 0xffff)
        flush()
      }
    }
  }
  words.push(0)
  flush()
  const out = new Uint8Array(bytes.length + 2)
  const total = bytes.length + 2
  out[0] = (total >> 8) & 0xff
  out[1] = total & 0xff
  out.set(bytes, 2)
  return out
}

function decodeObject(data: Uint8Array, off: number): MenuOp[] {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const total = v.getUint16(off)
  const end = off + total
  const ops: MenuOp[] = []
  let p = off + 2
  const readText = (): string => {
    const len = v.getUint16(p)
    p += 2
    let s = ''
    for (let i = 0; i < len; i++) s += String.fromCharCode(data[p + i]!)
    p += len + (len & 1)
    return s
  }
  while (p + 1 < end) {
    const id = v.getUint16(p)
    p += 2
    if (id === 0) break
    if (id === 4) {
      ops.push({ op: 'text', s: readText() })
      continue
    }
    const idx = (id - 8) >> 2
    const name = CMD_IDS[idx]
    if (name === undefined) break
    if (name === 'PR') {
      p += 2 // the nested text token id
      ops.push({ op: 'proc', name: readText().toUpperCase() })
      continue
    }
    const nPar = CMD_PARAMS[idx]!
    const a = v.getInt16(p)
    const b = nPar >= 2 ? v.getInt16(p + 2) : 0
    p += nPar * 2
    switch (name) {
      case 'BA':
        ops.push({ op: 'bar', x: a, y: b })
        break
      case 'LI':
        ops.push({ op: 'line', x: a, y: b })
        break
      case 'EL':
        ops.push({ op: 'ellipse', rx: a, ry: b })
        break
      case 'LO':
        ops.push({ op: 'locate', x: a, y: b })
        break
      case 'IN':
        ops.push({ op: 'ink', sel: a, c: b })
        break
      case 'PA':
        ops.push({ op: 'pattern', n: a })
        break
      case 'BO':
        ops.push({ op: 'bob', n: a })
        break
      case 'IC':
        ops.push({ op: 'icon', n: a })
        break
      case 'OU':
        ops.push({ op: 'outline', n: a })
        break
      case 'SL':
        ops.push({ op: 'setline', n: a })
        break
      case 'SF':
        ops.push({ op: 'setfont', n: a })
        break
      case 'RE':
        ops.push({ op: 'reserve', n: a })
        break
      case 'SS':
        ops.push({ op: 'style', n: a })
        break
    }
  }
  return ops
}

export function menuToBank(tree: MenuTree): Uint8Array {
  // lay out nodes depth-first, then append each node's objects
  interface Slot {
    node: MenuNode
    off: number
    next: number
    lat: number
    obOffs: [number, number, number, number]
    prev: number
  }
  const slots: Slot[] = []
  const blobs: Array<{ off: number; data: Uint8Array }> = []
  let cursor = 0
  const layout = (list: MenuNode[]): number => {
    let firstOff = -1
    let prevSlot: Slot | null = null
    for (const n of list) {
      const slot: Slot = { node: n, off: cursor, next: 0, lat: 0, obOffs: [0, 0, 0, 0], prev: prevSlot ? prevSlot.off : 0 }
      cursor += 70
      slots.push(slot)
      if (firstOff < 0) firstOff = slot.off
      if (prevSlot) prevSlot.next = slot.off
      const obs = [n.obF, n.ob1, n.ob2, n.ob3]
      for (let i = 0; i < 4; i++) {
        const ob = obs[i]
        if (!ob) continue
        const enc = encodeObject(ob)
        slot.obOffs[i] = cursor
        blobs.push({ off: cursor, data: enc })
        cursor += enc.length + (enc.length & 1)
      }
      if (n.children.length > 0) slot.lat = layout(n.children)
      prevSlot = slot
    }
    return firstOff
  }
  layout(tree.roots)
  const out = new Uint8Array(cursor)
  const v = new DataView(out.buffer)
  for (const s of slots) {
    const n = s.node
    v.setUint32(s.off, s.prev)
    v.setUint32(s.off + 4, s.next)
    v.setUint32(s.off + 8, s.lat)
    v.setUint16(s.off + 12, n.nb)
    out[s.off + 14] = n.flags
    out[s.off + 15] = n.called ? 0xff : 0
    v.setInt16(s.off + 16, n.x)
    v.setInt16(s.off + 18, n.y)
    out[s.off + 34] = n.key.kind === 0 ? 0 : n.key.kind === 1 ? 1 : 0xff
    out[s.off + 35] = n.key.asc
    out[s.off + 36] = n.key.scan
    out[s.off + 37] = n.key.shift
    v.setUint32(s.off + 38, s.obOffs[0])
    v.setUint32(s.off + 42, s.obOffs[1])
    v.setUint32(s.off + 46, s.obOffs[2])
    v.setUint32(s.off + 50, s.obOffs[3])
    out[s.off + 64] = n.inks1[0]
    out[s.off + 65] = n.inks1[1]
    out[s.off + 66] = n.inks1[2]
    out[s.off + 67] = n.inks2[0]
    out[s.off + 68] = n.inks2[1]
    out[s.off + 69] = n.inks2[2]
  }
  for (const b of blobs) out.set(b.data, b.off)
  return out
}

export function bankToMenu(tree: MenuTree, data: Uint8Array): void {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const readList = (off: number, depth: number): MenuNode[] => {
    const list: MenuNode[] = []
    let p = off
    let guard = 0
    let first = true
    // the first record may sit at offset 0 — 0 only means "no next" later
    while ((first || p !== 0) && p + 70 <= data.length && guard++ < 1000) {
      first = false
      const node = newMenuNode(v.getUint16(p + 12), data[p + 14]!)
      node.called = data[p + 15]! !== 0
      node.x = v.getInt16(p + 16)
      node.y = v.getInt16(p + 18)
      const kf = data[p + 34]!
      node.key = {
        kind: kf === 0 ? 0 : kf === 1 ? 1 : -1,
        asc: data[p + 35]!,
        scan: data[p + 36]!,
        shift: data[p + 37]!,
      }
      const obF = v.getUint32(p + 38)
      const ob1 = v.getUint32(p + 42)
      const ob2 = v.getUint32(p + 46)
      const ob3 = v.getUint32(p + 50)
      node.obF = obF !== 0 && obF < data.length ? decodeObject(data, obF) : null
      node.ob1 = ob1 !== 0 && ob1 < data.length ? decodeObject(data, ob1) : null
      node.ob2 = ob2 !== 0 && ob2 < data.length ? decodeObject(data, ob2) : null
      node.ob3 = ob3 !== 0 && ob3 < data.length ? decodeObject(data, ob3) : null
      node.inks1 = [data[p + 64]!, data[p + 65]!, data[p + 66]!]
      node.inks2 = [data[p + 67]!, data[p + 68]!, data[p + 69]!]
      const lat = v.getUint32(p + 8)
      if (lat !== 0 && lat + 70 <= data.length && depth < 8) node.children = readList(lat, depth + 1)
      list.push(node)
      p = v.getUint32(p + 4)
    }
    return list
  }
  tree.reset()
  tree.roots = readList(0, 1)
  tree.change = true
}
