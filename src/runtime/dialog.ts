import type { PacPicture } from '../loader/pacpic'
import type { ResourceBank } from '../loader/resource'

/**
 * The Interface language — AMOS Pro's dialog scripting engine, ported from
 * the Dia_* routines in +Lib.s (the token tables at 21077-21244, the
 * character classes at 24689-24833, the interpreter at 21258+, the
 * expression evaluator at 22748+, the pre-pass at 19889-20222).
 *
 * A dialog program is raw ASCII: statements are 2-letter mnemonics with
 * comma-separated parameters, terminated by any separator (usually ';');
 * `[` `]` bracket routines (button draw/change routines, IF blocks, whole
 * label routines). It is NOT compiled: Dialog Open makes one syntax-check
 * pass recording label (LA) and user-instruction (UI) offsets, and every
 * Dialog Run re-interprets the text.
 *
 * Expressions are pure postfix over a 32-bit value stack: `SWSX-2/` is
 * (SW - SX) / 2. The stack must hold exactly one value at each terminator.
 */

// ---- errors (EDia_* +Equ.s:1151-1162) ----

export const DIALOG_ERRORS: Record<number, string> = {
  1: 'dialog syntax error',
  2: 'dialog out of memory',
  3: 'dialog label already defined',
  4: 'dialog label not defined',
  5: 'dialog channel already opened',
  6: 'dialog channel not opened',
  7: 'screen not opened',
  8: 'dialog variable not defined',
  9: 'dialog function call error',
  10: 'dialog type mismatch',
  11: 'dialog out of buffer',
  12: 'dialog wrong number of parameters',
}

export class DialogError extends Error {
  constructor(
    readonly code: number,
    readonly position: number,
  ) {
    super(DIALOG_ERRORS[code] ?? `dialog error ${code}`)
  }
}

// ---- instruction tables (Dia_Instr / Dia_NParam, +Lib.s:21079-21181) ----

export const DIALOG_INSTRS = [
  'EX', 'UN', 'LI', 'BO', 'SI', 'BA', 'PU', 'SV', 'IL', 'PR',
  'PO', 'IN', 'SF', 'SW', 'SL', 'SP', 'BU', 'JP', 'RU', 'BR',
  'ED', 'JS', 'RT', 'BC', 'KY', 'SA', 'DI', 'BL', 'LA', 'BQ',
  'HS', 'VS', 'AL', 'IL', 'ZC', 'UI', 'GB', 'GS', 'GL', 'IF',
  'SZ', 'XY', 'NW', 'VT', 'VL', 'HT', 'CA', 'SM', 'GE', 'GP',
  'SS',
] as const

export const DIALOG_NPARAMS = [
  0, 3, 4, 5, 2, 2, 1, 2, 0, 4,
  5, 3, 2, 1, 1, 2, 8, 1, 2, 1,
  8, 1, 0, 2, 2, 1, 8, 1, 1, 0,
  9, 9, 10, 10, 2, 0, 4, 4, 4, 1,
  1, 4, 0, 4, 4, 10, 1, 0, 4, 3,
  8,
]

/** first matching index, like the linear .Find scan */
function findInstr(mn: string): number {
  return DIALOG_INSTRS.indexOf(mn as (typeof DIALOG_INSTRS)[number])
}

// ---- character classes (Dia_Chr .Codes, +Lib.s:24700-24833) ----

const C_SKIP = 0
const C_LETTER = 1
const C_SIGN = 2
const C_END = 3 // NUL / end of text
const C_TERM = 4 // , ; : `
const C_DIGIT = 5 // 0-9 $ %

const CHR_CLASS = new Uint8Array(256).fill(C_SKIP)
{
  CHR_CLASS[0] = C_END
  // controls 1-31 and space: skip
  for (const c of '!"#&\'*+-/<=>?@[\\]^_') CHR_CLASS[c.charCodeAt(0)] = C_SIGN
  for (const c of '$%0123456789') CHR_CLASS[c.charCodeAt(0)] = C_DIGIT
  for (const c of ',;:`') CHR_CLASS[c.charCodeAt(0)] = C_TERM
  for (let c = 65; c <= 90; c++) CHR_CLASS[c] = C_LETTER
  // lowercase, '(' ')' '.' '{' '}' '~', DEL, and everything >= 128: skip
  // (note '|' carries the $80 skip bit in the original table, so the OR
  // operator is unreachable — transcribed faithfully)
}

// ---- expression function tokens (Dia_FTokens doc, +Lib.s:21196-21244) ----

/** single sign characters → dispatch index (the +Dialog_Funcs.bin sign list) */
const SIGN_FUNCS: Record<string, number> = {
  '+': 4, '-': 5, '*': 6, '/': 7, '"': 14, "'": 15, '#': 22, '!': 23,
  '=': 40, '\\': 41, '<': 42, '>': 43, '&': 44, '|': 45,
}

/** two-letter tokens → dispatch index */
const PAIR_FUNCS: Record<string, number> = {
  AR: 29, AS: 49,
  BX: 0, BY: 1, BP: 21,
  CX: 16,
  ME: 9, MI: 19, MA: 20, MZ: 24,
  NE: 8,
  P1: 31, P2: 32, P3: 33, P4: 34, P5: 35, P6: 36, P7: 37, P8: 38, P9: 39,
  SX: 2, SY: 3, SW: 17, SH: 18,
  TW: 11, TH: 12, TL: 48,
  VA: 13,
  XA: 25, XB: 27,
  YA: 26, YB: 28,
  ZP: 30, ZV: 46, ZN: 47,
}

// ---- host services ----

export interface DialogHost {
  /** current screen text sizes for SW/SH (EcTx/EcTy of T_EcCourant) */
  screenWidth(): number
  screenHeight(): number
  /** TW/TH via the current font */
  textWidth(s: string): number
  textHeight(): number
  /** AR/AS array bridge: handle (a value > 1024) → int array */
  resolveArray(handle: number): Int32Array | null
}

// ---- zones ----

export type ZoneKind = 'button' | 'edit' | 'digit' | 'list' | 'hyper' | 'key' | 'slider'

export interface DialogZone {
  kind: ZoneKind
  number: number
  /** screen coords (base already added, Dia_GetEntete) */
  x: number
  y: number
  sx: number
  sy: number
  pos: number
  min: number
  max: number
  /** script offsets of the [draw] and [change] routines */
  rdraw: number
  rchange: number
  /** ZoVar: the NextZone counter at creation */
  zvar: number
  nowait: boolean
  quit: boolean
  changing: boolean
  /** result pushed by BR from within this zone's routines */
  value: number | string | null
  // edit/digit state
  text?: string
  maxLen?: number
  pap?: number
  pen?: number
  // key zones
  code?: number
  shift?: number
  // sliders
  total?: number
  size?: number
  step?: number
  vertical?: boolean
}

// ---- the channel ----

export class DialogChannel {
  script = ''
  labels = new Map<number, number>()
  userInstrs = new Map<string, { nParams: number; off: number }>()
  vars: Array<number | string> = []
  /** pseudo-vars -1/-2/-3 (Dia_BP / Dia_BR / current zone) */
  bp: number | string = 0
  br: number | string = 0
  curZone: DialogZone | null = null
  nextZone = 0
  baseX = 0
  baseY = 0
  sizeX = 0
  sizeY = 0
  xa = 0
  ya = 0
  xb = 0
  yb = 0
  /** PU: image number offset into the resource graphics */
  puzzleBase = 0
  screenNb = 0
  res: ResourceBank
  zones: DialogZone[] = []
  drawn = false
  frozen = false
  /** Dia_Return, read-and-cleared by =Dialog(n) */
  ret = 0
  runState: 'idle' | 'waiting' | 'done' = 'idle'
  /** RU flags/timer */
  runFlags = 0
  timer = 0
  timerStart = 0
  /** SS: dialog slider colours (SlDInit +Lib.s:20211) */
  sliderCfg = [0, 0, 0, 1, 4, 4, 4, 1, 0, 0, 0, 1, 3, 3, 3, 1]
  /** user-instruction call depth and param stack */
  uiParams: Array<Array<number | string>> = []
  /** last unpacked image size (Dia_PuzzleSx/Sy) */
  puzzleSx = 0
  puzzleSy = 0
  /** SA/BL screen blocks by number, and the SA restore order (LIFO) */
  blocks = new Map<number, { saved: unknown }>()
  saOrder: number[] = []
  /** paused execution across RU (resumed by stepDialogs) */
  exec: DialogExec | null = null

  constructor(
    readonly channel: number,
    readonly nVars: number,
    res: ResourceBank,
  ) {
    this.res = res
    for (let i = 0; i < nVars; i++) this.vars.push(0)
  }

  getVar(n: number): number | string {
    if (n === -1) return this.bp
    if (n === -2) return this.br
    return this.vars[n] ?? 0
  }

  setVar(n: number, v: number | string): void {
    if (n === -1) this.bp = v
    else if (n === -2) this.br = v
    else if (n >= 0 && n < this.vars.length) this.vars[n] = v
  }
}

// ---- the script cursor (Dia_Chr) ----

export class Cursor {
  pos = 0
  constructor(readonly text: string) {}

  /** classified read: skips skip-class chars, returns {ch, cls} */
  next(): { ch: string; cls: number } {
    for (;;) {
      if (this.pos >= this.text.length) return { ch: '\0', cls: C_END }
      const code = this.text.charCodeAt(this.pos++) & 0xff
      const cls = code >= 128 ? C_SKIP : CHR_CLASS[code]!
      if (cls === C_SKIP) continue
      return { ch: String.fromCharCode(code), cls }
    }
  }

  /** raw byte read (Dia_ChrC), for number/string scanning */
  raw(): string {
    if (this.pos >= this.text.length) return '\0'
    return this.text[this.pos++]!
  }

  back(): void {
    this.pos--
  }
}

/** number literal: decimal, $hex (upper A-F), %binary (Dia_FChif) */
function scanNumber(cur: Cursor, first: string): number {
  let base = 10
  let v = 0
  if (first === '$') base = 16
  else if (first === '%') base = 2
  else v = first.charCodeAt(0) - 48
  for (;;) {
    const c = cur.raw()
    if (c === '\0') break
    const d = digitVal(c, base)
    if (d < 0) {
      cur.back()
      break
    }
    v = (v * base + d) | 0
  }
  return v
}

function digitVal(c: string, base: number): number {
  const n = c.charCodeAt(0)
  if (n >= 48 && n <= 57) {
    const d = n - 48
    return d < base ? d : -1
  }
  if (base === 16 && n >= 65 && n <= 70) return n - 55
  return -1
}

// ---- pre-pass (Dia_OpenChannel, +Lib.s:19962-20155) ----

/**
 * One syntax-check pass over the whole script: every statement's mnemonic
 * must exist (or be a UI call), every parameter expression must scan, and
 * LA/UI statements are recorded. `[` and `]` are skipped at statement level.
 * Throws DialogError(code, position) exactly where the 68k stores
 * Dia_ErrorPos.
 */
export function prescanDialog(script: string): {
  labels: Map<number, number>
  userInstrs: Map<string, { nParams: number; off: number }>
} {
  const cur = new Cursor(script)
  const labels = new Map<number, number>()
  const userInstrs = new Map<string, { nParams: number; off: number }>()
  const synt = (): never => {
    throw new DialogError(1, cur.pos)
  }

  // syntax-mode expression scan; returns the terminator char
  const scanExpr = (): string => {
    for (;;) {
      const { ch, cls } = cur.next()
      if (cls === C_END) synt()
      if (cls === C_TERM) return ch
      if (cls === C_DIGIT) {
        scanNumber(cur, ch)
        continue
      }
      if (cls === C_SIGN) {
        const fn = SIGN_FUNCS[ch]
        if (fn === undefined) synt()
        if (ch === '"' || ch === "'") {
          // string literal: verbatim to the matching quote, controls illegal
          for (;;) {
            const c = cur.raw()
            if (c === '\0' || c.charCodeAt(0) < 32) synt()
            if (c === ch) break
          }
        }
        continue
      }
      // letter: the pair must exist in this letter's own list
      const second = cur.next()
      if (second.cls === C_END) synt()
      if (PAIR_FUNCS[ch + second.ch] === undefined) synt()
    }
  }

  // literal number after LA / UI count (digit class required)
  const literal = (): number => {
    const { ch, cls } = cur.next()
    if (cls !== C_DIGIT) synt()
    return scanNumber(cur, ch)
  }

  for (;;) {
    const first = cur.next()
    if (first.cls === C_END) break
    if (first.ch === '[' || first.ch === ']') continue
    const second = cur.next()
    if (second.cls === C_END) synt()
    const mn = first.ch + second.ch
    const idx = findInstr(mn)
    if (idx < 0) {
      // user-instruction call: skip comma-separated expressions
      const t = cur.next()
      if (t.cls === C_END) synt()
      if (t.cls !== C_TERM) {
        cur.back()
        while (scanExpr() === ',') {
          /* next parameter */
        }
      }
      continue
    }
    if (idx === 28) {
      // LA n; — literal label number < 65536, no duplicates
      const n = literal()
      if (n >= 65536 || n < 0) synt()
      if (labels.has(n)) throw new DialogError(3, cur.pos)
      const sep = cur.next()
      if (sep.cls === C_END || sep.cls === C_LETTER) synt()
      labels.set(n, cur.pos)
      continue
    }
    if (idx === 35) {
      // UIxy,n;[ — define a user instruction
      const a = cur.next()
      if (a.cls !== C_LETTER) synt()
      const b = cur.next()
      if (b.cls !== C_LETTER) synt()
      const name = a.ch + b.ch
      if (findInstr(name) >= 0 || userInstrs.has(name)) throw new DialogError(3, cur.pos)
      const comma = cur.next()
      if (comma.ch !== ',') synt()
      const count = literal()
      if (count > 9) synt()
      const sep = cur.next()
      if (sep.cls === C_LETTER) synt()
      const bracket = cur.next()
      if (bracket.ch !== '[') synt()
      userInstrs.set(name, { nParams: count, off: cur.pos })
      continue
    }
    const nPar = DIALOG_NPARAMS[idx]!
    if (nPar === 0) {
      // separator required (terminator class)
      const t = cur.next()
      if (t.cls !== C_TERM) synt()
      continue
    }
    for (let i = 0; i < nPar; i++) {
      const term = scanExpr()
      if (i < nPar - 1 && term !== ',') throw new DialogError(12, cur.pos)
    }
  }
  return { labels, userInstrs }
}

// ---- runtime expression evaluation (Dia_Evalue, +Lib.s:22748+) ----

export type DialogValue = number | string

export interface EvalContext {
  ch: DialogChannel
  host: DialogHost
}

const w16 = (n: number): number => (n << 16) >> 16

/**
 * Evaluate one postfix expression up to (and consuming) its terminator.
 * Returns the single remaining stack value; depth != 1 at the end is a
 * dialog syntax error, exactly like `cmp.w #1,d7` at .Fini.
 */
export function evalExpr(cur: Cursor, ctx: EvalContext): DialogValue {
  const stack: DialogValue[] = []
  const synt = (): never => {
    throw new DialogError(1, cur.pos)
  }
  const fonc = (): never => {
    throw new DialogError(9, cur.pos)
  }
  const pop = (): DialogValue => {
    if (stack.length === 0) synt()
    return stack.pop()!
  }
  const popInt = (): number => {
    const v = pop()
    return typeof v === 'number' ? v : 0
  }
  const popStr = (): string => {
    const v = pop()
    return typeof v === 'string' ? v : String(v)
  }
  const need = (n: number): void => {
    if (stack.length < n) synt()
  }

  const apply = (fn: number): void => {
    switch (fn) {
      case 0: // BX
        stack.push(ctx.ch.baseX)
        break
      case 1: // BY
        stack.push(ctx.ch.baseY)
        break
      case 2: // SX
        stack.push(ctx.ch.sizeX)
        break
      case 3: // SY
        stack.push(ctx.ch.sizeY)
        break
      case 4: { // + (32-bit add)
        need(2)
        const b = popInt()
        stack.push((popInt() + b) | 0)
        break
      }
      case 5: { // -
        need(2)
        const b = popInt()
        stack.push((popInt() - b) | 0)
        break
      }
      case 6: { // * — muls: 16x16 signed (low words)
        need(2)
        const b = popInt()
        stack.push(Math.imul(w16(popInt()), w16(b)))
        break
      }
      case 7: { // / — divs: 32/16 signed, /0 = syntax error
        need(2)
        const b = popInt()
        if (b === 0 || w16(b) === 0) synt()
        stack.push(Math.trunc(popInt() / w16(b)) | 0)
        break
      }
      case 8: { // NE — negate top in place, needs depth >= 1
        need(1)
        stack.push((-popInt()) | 0)
        break
      }
      case 9:
      case 10: { // ME — message n (1-based, Dia_FMess)
        need(1)
        const n = popInt()
        if (n <= 0) fonc()
        const msg = ctx.ch.res.messages?.[n - 1]
        if (msg === undefined) fonc()
        stack.push(msg!)
        break
      }
      case 11: // TW
        need(1)
        stack.push(ctx.host.textWidth(popStr()))
        break
      case 12: // TH
        stack.push(ctx.host.textHeight())
        break
      case 13: { // VA n — replace top with vars[n]
        need(1)
        stack.push(ctx.ch.getVar(popInt()))
        break
      }
      case 16: { // CX — centred x: max(0, sizeX - TW(t)) / 2
        need(1)
        const w = ctx.host.textWidth(popStr())
        stack.push(Math.max(0, ctx.ch.sizeX - w) >> 1)
        break
      }
      case 17: // SW
        stack.push(ctx.host.screenWidth())
        break
      case 18: // SH
        stack.push(ctx.host.screenHeight())
        break
      case 19: { // MI
        need(2)
        const b = popInt()
        stack.push(Math.min(popInt(), b))
        break
      }
      case 20: { // MA
        need(2)
        const b = popInt()
        stack.push(Math.max(popInt(), b))
        break
      }
      case 21: // BP
      case 30: // ZP
        stack.push(ctx.ch.bp)
        break
      case 22: { // # — int to ASCII
        need(1)
        stack.push(String(popInt()))
        break
      }
      case 23: { // ! — string concat (below + top)
        need(2)
        const b = popStr()
        stack.push(popStr() + b)
        break
      }
      case 24: { // MZ maxlen addr — copy a below-space-terminated string
        need(2)
        popInt() // maxlen
        popInt() // address — raw memory strings are not carried by the port
        stack.push('')
        break
      }
      case 25: // XA
        stack.push(ctx.ch.xa)
        break
      case 26: // YA
        stack.push(ctx.ch.ya)
        break
      case 27: // XB
        stack.push(ctx.ch.xb)
        break
      case 28: // YB
        stack.push(ctx.ch.yb)
        break
      case 29: { // AR — array element (handle > 1024, Dia_FArray)
        need(2)
        const i = popInt()
        const handle = popInt()
        if (handle <= 1024) fonc()
        const arr = ctx.host.resolveArray(handle)
        if (!arr || i < 0 || i >= arr.length) fonc()
        stack.push(arr![i]!)
        break
      }
      case 46: // ZV
        stack.push(ctx.ch.curZone ? ctx.ch.curZone.zvar : ctx.ch.nextZone)
        break
      case 47: { // ZN — current zone number, error outside a zone routine
        if (!ctx.ch.curZone) synt()
        stack.push(ctx.ch.curZone!.number)
        break
      }
      case 48: { // TL — string length
        need(1)
        stack.push(popStr().length)
        break
      }
      case 49: { // AS — array size (0 stays 0)
        need(1)
        const handle = popInt()
        if (handle === 0) {
          stack.push(0)
          break
        }
        if (handle <= 1024) fonc()
        const arr = ctx.host.resolveArray(handle)
        if (!arr) fonc()
        stack.push(arr!.length)
        break
      }
      case 40: { // =
        need(2)
        const b = popInt()
        stack.push(popInt() === b ? -1 : 0)
        break
      }
      case 41: { // \
        need(2)
        const b = popInt()
        stack.push(popInt() !== b ? -1 : 0)
        break
      }
      case 42: { // <
        need(2)
        const b = popInt()
        stack.push(popInt() < b ? -1 : 0)
        break
      }
      case 43: { // >
        need(2)
        const b = popInt()
        stack.push(popInt() > b ? -1 : 0)
        break
      }
      case 44: { // & — bitwise
        need(2)
        const b = popInt()
        stack.push(popInt() & b)
        break
      }
      case 45: { // |
        need(2)
        const b = popInt()
        stack.push(popInt() | b)
        break
      }
      default: {
        // P1..P9 (31-39): user-instruction parameters, first arg = P1
        if (fn >= 31 && fn <= 39) {
          const params = ctx.ch.uiParams[ctx.ch.uiParams.length - 1]
          if (!params) synt()
          const v = params![fn - 31]
          if (v === undefined) synt()
          stack.push(v!)
          break
        }
        synt()
      }
    }
  }

  for (;;) {
    const { ch, cls } = cur.next()
    if (cls === C_END || cls === C_TERM) break
    if (cls === C_DIGIT) {
      stack.push(scanNumber(cur, ch))
      continue
    }
    if (cls === C_SIGN) {
      if (ch === '"' || ch === "'") {
        // string literal, verbatim until the matching quote; a control
        // char ends it early (Dia_FStr pushes back, no error)
        let s = ''
        for (;;) {
          const c = cur.raw()
          if (c === '\0' || c.charCodeAt(0) < 32) {
            cur.back()
            break
          }
          if (c === ch) break
          s += c
        }
        stack.push(s)
        continue
      }
      const fn = SIGN_FUNCS[ch]
      if (fn === undefined) synt()
      apply(fn!)
      continue
    }
    // letter pair
    const second = cur.next()
    const fn = PAIR_FUNCS[ch + second.ch]
    if (fn === undefined) synt()
    apply(fn!)
  }
  if (stack.length !== 1) synt()
  return stack[0]!
}

// ---- drawing services (implemented by the Runtime on the bound screen) ----

export interface DialogDraw {
  /** Dia_Active / Dia_ReActive: set/restore the drawing target screen */
  activate(screenNb: number): void
  deactivate(): void
  /** stamp an unpacked resource image (UN/LI/VL/BO) */
  stamp(img: PacPicture, x: number, y: number): void
  /** BO middle fill: copy rect [x1,ySrc,x2,ySrc+h) to yDest (Dia_ScCopy) */
  copyRect(x1: number, ySrc: number, x2: number, h: number, yDest: number): void
  setPen(c: number): void
  setBPen(c: number): void
  setOutlinePen(c: number): void
  rectFill(x1: number, y1: number, x2: number, y2: number): void
  outlineRect(x1: number, y1: number, x2: number, y2: number): void
  line(x1: number, y1: number, x2: number, y2: number): void
  ellipse(x: number, y: number, rx: number, ry: number): void
  plot(x: number, y: number): void
  /** top-left text with the current pen and writing mode */
  text(x: number, y: number, s: string): void
  setWriting(mode: number): void
  setLinePattern(p: number): void
  setFillPattern(p: number, outline: number): void
  setFont(font: number, style: number): void
  grabBlock(x: number, y: number, w: number, h: number): unknown
  putBlock(saved: unknown): void
  clearKeys(): void
  clearClicks(): void
}

export type ExecResult = { status: 'exit' } | { status: 'run' }

interface ExecFrame {
  kind: 'if' | 'ui'
  ret: number
}

/**
 * The statement interpreter (Dia_Loop +Lib.s:21258). One instance runs a
 * whole =Dialog Run; RU pauses it (status 'run') and stepDialogs resumes
 * the tail after the wait completes.
 */
export class DialogExec {
  readonly cur: Cursor
  private frames: ExecFrame[] = []
  private jsStack: number[] = []
  readonly ctx: EvalContext

  constructor(
    readonly ch: DialogChannel,
    readonly host: DialogHost,
    readonly draw: DialogDraw,
  ) {
    this.cur = new Cursor(ch.script)
    this.ctx = { ch, host }
  }

  private synt(): never {
    throw new DialogError(1, this.cur.pos)
  }

  private fonc(): never {
    throw new DialogError(9, this.cur.pos)
  }

  private evalOne(): DialogValue {
    return evalExpr(this.cur, this.ctx)
  }

  private evalInt(): number {
    const v = this.evalOne()
    return typeof v === 'number' ? v : 0
  }

  private evalStr(): string {
    const v = this.evalOne()
    return typeof v === 'string' ? v : String(v)
  }

  /** raw scan past the next unmatched `]` (Dia_If .Skip) */
  private skipBrackets(): void {
    let depth = 1
    for (;;) {
      const c = this.cur.raw()
      if (c === '\0') this.synt()
      if (c === '[') depth++
      else if (c === ']' && --depth === 0) return
    }
  }

  /** jump to label n (Dia_GetLabel: unknown label = offset 0) */
  private jumpLabel(n: number): void {
    this.cur.pos = this.ch.labels.get(n) ?? 0
  }

  run(startPos?: number): ExecResult {
    if (startPos !== undefined) this.cur.pos = startPos
    const ch = this.ch
    const draw = this.draw
    for (;;) {
      const first = this.cur.next()
      if (first.cls === C_END) this.synt() // must end with EX or ]
      if (first.ch === ']') {
        if (this.routineEnd()) return { status: 'exit' }
        continue
      }
      const second = this.cur.next()
      if (second.cls === C_END) this.synt()
      const mn = first.ch + second.ch
      const idx = findInstr(mn)
      if (idx < 0) {
        this.userCall(mn)
        continue
      }
      const nPar = DIALOG_NPARAMS[idx]!
      // self-parsing instructions (7+ params, .Params `cmp.w #7 bcc .Call`)
      if (nPar >= 7) {
        this.bigInstr(idx)
        continue
      }
      const v: DialogValue[] = []
      if (nPar === 0) {
        this.cur.next() // .NoPar: one classified char is always consumed
      } else {
        for (let i = 0; i < nPar; i++) v.push(this.evalOne())
      }
      const int = (i: number): number => {
        const x = v[i]
        return typeof x === 'number' ? x : 0
      }
      const str = (i: number): string => {
        const x = v[i]
        return typeof x === 'string' ? x : String(x)
      }
      switch (idx) {
        case 0: // EX — quit the current loop level, like `]` (Dia_Quit)
          if (this.routineEnd()) return { status: 'exit' }
          break
        case 1: // UN x,y,i
          this.unpack(int(2), int(0), int(1))
          break
        case 2: // LI x,y,i,x2
          this.tiled(false, int(0), int(1), int(2), int(3))
          break
        case 44: // VL x,y,i,y2
          this.tiled(true, int(0), int(1), int(2), int(3))
          break
        case 3: // BO x,y,i,x2,y2 — 9-patch (Dia_Box +Lib.s:21733)
          this.ninePatch(int(0), int(1), int(2), int(3), int(4))
          break
        case 4: // SI sx,sy — sx rounded up to 16
          ch.sizeX = (int(0) + 15) & ~15
          ch.sizeY = int(1)
          break
        case 5: // BA x,y — x masked to 16
          ch.baseX = int(0) & ~15
          ch.baseY = int(1)
          break
        case 6: // PU i
          ch.puzzleBase = int(0)
          break
        case 7: // SV n,v
          ch.setVar(int(0), v[1]!)
          break
        case 9: { // PR x,y,text,ink
          this.print(int(0), int(1), str(2), int(3))
          break
        }
        case 10: { // PO x,y,text,p0,p1 — outlined print (Dia_Outline)
          const [x, y, t] = [int(0), int(1), str(2)]
          draw.setWriting(0)
          this.print(x - 1, y, t, int(3))
          this.print(x + 1, y, t, -1)
          this.print(x, y - 1, t, -1)
          this.print(x, y + 1, t, -1)
          this.print(x, y, t, int(4))
          break
        }
        case 43: { // VT x,y,text,pen — vertical text
          const [x, y, t, pen] = [int(0), int(1), str(2), int(3)]
          if (pen >= 0) draw.setPen(pen)
          ch.xa = x
          ch.ya = y
          ch.xb = x
          ch.yb = y
          const h = this.host.textHeight()
          for (let i = 0; i < t.length; i++) {
            draw.text(ch.baseX + x, ch.baseY + y + i * h, t[i]!)
            ch.xb += h // faithful quirk: XB advances, not YB
          }
          break
        }
        case 11: { // IN a,b,c — -1 keeps (order C,B,A in Dia_SInk)
          if (int(2) >= 0) draw.setOutlinePen(int(2))
          if (int(1) >= 0) draw.setBPen(int(1))
          if (int(0) >= 0) draw.setPen(int(0))
          break
        }
        case 12: // SF font,style — -1 keeps
          draw.setFont(int(0), int(1))
          break
        case 13: // SW mode — -1 keeps
          if (int(0) >= 0) draw.setWriting(int(0))
          break
        case 14: // SL pattern — -1 keeps
          if (int(0) >= 0) draw.setLinePattern(int(0))
          break
        case 15: // SP pattern,outline
          draw.setFillPattern(int(0), int(1))
          break
        case 17: // JP label
          this.jumpLabel(int(0))
          break
        case 28: // LA n — re-syncs to just after the label (Dia_Label)
          this.jumpLabel(int(0))
          break
        case 21: // JS label
          this.jsStack.push(this.cur.pos)
          this.jumpLabel(int(0))
          break
        case 22: { // RT
          const ret = this.jsStack.pop()
          if (ret === undefined) this.synt()
          this.cur.pos = ret!
          break
        }
        case 18: { // RU timer,flag — enter the wait loop (Dia_Run)
          ch.timer = int(0)
          ch.runFlags = int(1) & 0xff
          if (ch.runFlags & 1) draw.clearKeys()
          if (ch.runFlags & 2) draw.clearClicks()
          return { status: 'run' }
        }
        case 19: // BR v — button return value into pseudo-var -2
          ch.br = v[0]!
          break
        case 25: // SA n — save block with restore record
          ch.saOrder.push(int(0))
          this.grab(int(0))
          break
        case 27: // BL n — (re)grab without record
          this.grab(int(0))
          break
        case 29: // BQ — quit flag on the current zone
          if (!ch.curZone) this.synt()
          ch.curZone!.quit = true
          break
        case 42: // NW — nowait flag
          if (!ch.curZone) this.synt()
          ch.curZone!.nowait = true
          break
        case 23: { // BC n,pos — change another button (Dia_BChange)
          if (!ch.curZone) this.synt()
          if (ch.curZone!.changing) break
          const [n, pos] = [int(0), int(1)]
          for (const z of ch.zones) {
            if (z.kind !== 'button' || z.number !== n || z === ch.curZone) continue
            if (z.pos !== pos) {
              z.changing = true
              z.pos = pos
              this.buttonDraw(z)
              this.zoneChange(z)
              z.changing = false
            }
            z.quit = false
          }
          break
        }
        case 34: // ZC n,pos — phase 5 (zone update)
          if (!ch.curZone) this.synt()
          break
        case 36: { // GB x1,y1,x2,y2 — filled box, pen A
          const [x1, y1, x2, y2] = [int(0), int(1), int(2), int(3)]
          ch.xa = x1
          ch.ya = y1
          ch.xb = x2
          ch.yb = y2
          if (x2 <= x1 || y2 <= y1) this.fonc()
          draw.rectFill(ch.baseX + x1, ch.baseY + y1, ch.baseX + x2, ch.baseY + y2)
          break
        }
        case 37: { // GS x1,y1,x2,y2 — outline box
          const [x1, y1, x2, y2] = [int(0), int(1), int(2), int(3)]
          ch.xa = x1
          ch.ya = y1
          ch.xb = x2
          ch.yb = y2
          draw.outlineRect(ch.baseX + x1, ch.baseY + y1, ch.baseX + x2, ch.baseY + y2)
          break
        }
        case 38: { // GL x1,y1,x2,y2
          const [x1, y1, x2, y2] = [int(0), int(1), int(2), int(3)]
          ch.xa = x1
          ch.ya = y1
          ch.xb = x2
          ch.yb = y2
          draw.line(ch.baseX + x1, ch.baseY + y1, ch.baseX + x2, ch.baseY + y2)
          break
        }
        case 39: { // IF cond;[...] (Dia_If +Lib.s:21594)
          const cond = int(0)
          const bracket = this.cur.next()
          if (bracket.ch !== '[') this.synt()
          if (cond !== 0) {
            // run the block; its `]` pops the frame and skips the rest of
            // the enclosing routine
            this.frames.push({ kind: 'if', ret: 0 })
          } else {
            this.skipBrackets()
          }
          break
        }
        case 46: // CA addr — calls 68k machine code; not portable
          this.fonc()
          break
        case 47: // SM — interactive screen drag (no-op in the port)
          break
        case 48: { // GE x,y,r1,r2
          const [x, y, r1, r2] = [int(0), int(1), int(2), int(3)]
          if (r1 <= 0 || r2 <= 0) this.fonc()
          // faithful quirk: XA/YA both get x, XB/YB both get y
          ch.xa = x
          ch.ya = x
          ch.xb = y
          ch.yb = y
          draw.ellipse(ch.baseX + x, ch.baseY + y, r1, r2)
          break
        }
        case 49: { // GP x,y,i — unbased plot (Dia_GPlot quirks kept)
          const [x, y, i] = [int(0), int(1), int(2)]
          if (i >= 0) draw.setPen(i)
          ch.xa = x
          ch.ya = x
          ch.xb = y + 1
          ch.yb = y + 1
          draw.plot(x, y)
          break
        }
        case 8: // IL slot 8 — Dia_Illegal
        case 35: // UI reached at runtime — Dia_Synt
          this.synt()
          break
        default:
          this.synt()
      }
    }
  }

  /** instructions with 7+ parameters parse their own arguments (.Params) */
  private bigInstr(idx: number): void {
    if (idx === 50) {
      // SS a,b,c,p,a,b,c,p (Dia_SetSlider): 8 bytes, then copied over the
      // active set
      for (let i = 0; i < 8; i++) this.ch.sliderCfg[i] = this.evalInt() & 0xff
      for (let i = 0; i < 8; i++) this.ch.sliderCfg[8 + i] = this.ch.sliderCfg[i]!
      return
    }
    // BU/ED/DI/HS/VS/AL/IL/HT: the zone engine (phases 5-7)
    this.synt()
  }

  /** `]` or EX: pop a frame, or end the routine (returns true at top level) */
  private routineEnd(): boolean {
    const f = this.frames.pop()
    if (!f) return true
    if (f.kind === 'ui') {
      this.ch.uiParams.pop()
      this.cur.pos = f.ret
      return false
    }
    // if-frame: skip the rest of the enclosing routine (Dia_If .Skip)
    this.skipBrackets()
    return false
  }

  /** unknown mnemonic: user-instruction call (Dia_Loop .Inst) */
  private userCall(mn: string): void {
    const def = this.ch.userInstrs.get(mn)
    if (!def) this.synt()
    if (this.ch.uiParams.length >= 10) this.fonc()
    const params: DialogValue[] = []
    if (def!.nParams === 0) {
      this.cur.next()
    } else {
      for (let i = 0; i < def!.nParams; i++) params.push(this.evalOne())
    }
    this.frames.push({ kind: 'ui', ret: this.cur.pos })
    this.ch.uiParams.push(params)
    this.cur.pos = def!.off
  }

  /** UN: stamp resource image i+puzzleBase at x,y (Dia_Unpack) */
  private unpack(i: number, x: number, y: number): void {
    const ch = this.ch
    const n = i + ch.puzzleBase
    if (n <= 0) this.synt()
    const g = ch.res.graphics
    if (!g || n > g.count) this.synt()
    const pic = g.image(n)
    if (!pic) this.synt()
    ch.xa = x
    ch.ya = y
    ch.xb = x
    ch.yb = y
    this.draw.stamp(pic!, ch.baseX + x, ch.baseY + y)
    ch.puzzleSx = pic!.width
    ch.puzzleSy = pic!.height
    ch.xb += pic!.width
    ch.yb += pic!.height
  }

  /** LI/VL: middle image i+1 tiled, capped by i and i+2 (Dia_Line/VLine) */
  private tiled(vertical: boolean, x: number, y: number, i: number, end: number): void {
    const ch = this.ch
    let cx = x
    let cy = y
    if (!vertical) {
      cx &= ~7
      end &= ~7
    } else {
      cx &= ~7
    }
    const start = vertical ? cy : cx
    let rem = end - start
    if (rem <= 0) this.fonc()
    // the body
    for (;;) {
      this.unpack(i + 1, cx, cy)
      const step = vertical ? ch.puzzleSy : ch.puzzleSx
      if (step === 0) break
      if (vertical) cy += step
      else cx += step
      rem -= step
      if (rem < step) break
    }
    // the near cap (image i at the original position)
    this.unpack(i, vertical ? cx & ~7 : x & ~7, vertical ? y : cy)
    // the far cap (image i+2 at end minus the cap size just recorded)
    if (vertical) this.unpack(i + 2, cx & ~7, end - ch.puzzleSy)
    else this.unpack(i + 2, end - ch.puzzleSx, cy)
    // Dia_BFin
    ch.xa = x & ~7
    ch.ya = y
  }

  /** BO: 9-patch — middle row drawn then copied down, then top and bottom */
  private ninePatch(x: number, y: number, i: number, x2: number, y2: number): void {
    const ch = this.ch
    let rem = y2 - y
    if (rem <= 0) this.fonc()
    // middle row (images i+3..i+5) at the top position
    this.tiled(false, x, y, i + 3, x2)
    const rowH = ch.puzzleSy
    if (rowH > 0) {
      rem -= rowH
      if (rem > 0) {
        let ySrc = y
        for (;;) {
          this.draw.copyRect(ch.baseX + (x & ~7), ch.baseY + ySrc, ch.baseX + (x2 & ~7), rowH, ch.baseY + ySrc + rowH)
          ySrc += rowH
          rem -= rowH
          if (rem < rowH) break
        }
      }
    }
    // top row (images i..i+2)
    this.tiled(false, x, y, i, x2)
    // bottom row (images i+6..i+8)
    this.tiled(false, x, y2 - ch.puzzleSy, i + 6, x2)
    ch.xa = x & ~7
    ch.ya = y
  }

  private print(x: number, y: number, t: string, ink: number): void {
    const ch = this.ch
    if (ink >= 0) this.draw.setPen(ink)
    ch.xa = x
    ch.ya = y
    ch.xb = x
    ch.yb = y
    this.draw.text(ch.baseX + x, ch.baseY + y, t)
    ch.xb += this.host.textWidth(t)
    ch.yb += this.host.textHeight()
  }

  /** SA/BL: grab the whole dialog box area as block n (Dia_Block2) */
  private grab(n: number): void {
    const ch = this.ch
    const bx = ch.baseX & ~15
    const sub = ch.baseX - bx
    const w = (ch.sizeX + sub + 15) & ~15
    ch.blocks.set(n, { saved: this.draw.grabBlock(bx, ch.baseY, w, ch.sizeY) })
  }

  /** run a zone's [draw routine] (phase 5 fills this in) */
  buttonDraw(z: DialogZone): void {
    void z
  }

  zoneChange(z: DialogZone): void {
    void z
  }
}

/**
 * Erase a drawn dialog (Dia_EffChanA0 +Lib.s:20726): close edit windows,
 * restore SA blocks in reverse order, delete them.
 */
export function eraseDialog(ch: DialogChannel, draw: DialogDraw): void {
  if (!ch.drawn) return
  draw.activate(ch.screenNb)
  for (let i = ch.saOrder.length - 1; i >= 0; i--) {
    const n = ch.saOrder[i]!
    const b = ch.blocks.get(n)
    if (b) {
      draw.putBlock(b.saved)
      ch.blocks.delete(n)
    }
  }
  ch.saOrder = []
  ch.blocks.clear()
  ch.zones = []
  ch.curZone = null
  draw.deactivate()
  ch.drawn = false
}
